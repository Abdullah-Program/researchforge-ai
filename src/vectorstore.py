"""
vectorstore.py
--------------
Manages ChromaDB persistent vector store.
Provides: add_documents(), semantic_search(), list_papers(), delete_collection()
Used by: tools.py, api.py
"""

import os
import uuid
import re
import math
from collections import Counter
import numpy as np
from pathlib import Path
from typing import List, Dict, Any

import chromadb

from ingestion import get_embedding_model   # reuse same model instance
# Document is imported lazily inside methods to avoid heavy startup chain


# ── Constants ─────────────────────────────────────────────────────────────────
VECTOR_STORE_DIR = Path(__file__).resolve().parent.parent / "data" / "vector_store"
COLLECTION_NAME  = "arxiv_papers"
# A safe fallback for ChromaDB versions that do not expose their configured limit.
DEFAULT_WRITE_BATCH_SIZE = 1_000
# Metadata reads must also stay below SQLite's parameter limit on large stores.
METADATA_READ_BATCH_SIZE = 1_000


# ── BM25 Sparse Search Helpers ────────────────────────────────────────────────
def tokenize(text: str) -> List[str]:
    """Simple alphanumeric lowercase word tokenization."""
    return re.findall(r'\w+', text.lower())


class SimpleBM25:
    """Pure Python implementation of BM25 algorithm for sparse search."""
    def __init__(self, corpus: List[List[str]], k1: float = 1.5, b: float = 0.75):
        self.k1 = k1
        self.b = b
        self.corpus_size = len(corpus)
        self.avgdl = sum(len(doc) for doc in corpus) / self.corpus_size if self.corpus_size > 0 else 0
        self.doc_freqs = []
        self.doc_len = []
        self.df = Counter()
        
        for doc in corpus:
            self.doc_len.append(len(doc))
            frequencies = Counter(doc)
            self.doc_freqs.append(frequencies)
            for word in frequencies.keys():
                self.df[word] += 1
                
        self.idf = {}
        for word, freq in self.df.items():
            # BM25 IDF formula with smoothing
            self.idf[word] = math.log(1.0 + (self.corpus_size - freq + 0.5) / (freq + 0.5))

    def get_scores(self, query: List[str]) -> List[float]:
        scores = []
        for i in range(self.corpus_size):
            score = 0.0
            doc_len = self.doc_len[i]
            freqs = self.doc_freqs[i]
            for word in query:
                if word not in freqs:
                    continue
                tf = freqs[word]
                idf = self.idf.get(word, 0.0)
                # BM25 formula
                numerator = tf * (self.k1 + 1)
                denominator = tf + self.k1 * (1.0 - self.b + self.b * (doc_len / self.avgdl))
                score += idf * (numerator / denominator)
            scores.append(score)
        return scores


# ── VectorStore Class ─────────────────────────────────────────────────────────
class VectorStore:
    """
    ChromaDB-backed vector store for research paper chunks.

    Public API used by tools.py / api.py:
        vs = VectorStore()
        vs.add_documents(chunks, embeddings)
        results = vs.semantic_search(query, top_k=5)
        results = vs.hybrid_search(query, top_k=5)
        papers  = vs.list_papers()
    """

    def __init__(
        self,
        collection_name: str = COLLECTION_NAME,
        persist_directory: str | Path = VECTOR_STORE_DIR,
    ):
        self.collection_name  = collection_name
        self.persist_directory = Path(persist_directory)
        self.client     = None
        self.collection = None
        self._init()

    # ── Setup ──────────────────────────────────────────────────────────────────
    def _init(self):
        """Initialize ChromaDB client and get/create collection."""
        self.persist_directory.mkdir(parents=True, exist_ok=True)

        self.client = chromadb.PersistentClient(
            path=str(self.persist_directory)
        )
        self.collection = self.client.get_or_create_collection(
            name=self.collection_name,
            metadata={"description": "ArXiv paper embeddings for RAG"},
        )
        print(f"[vectorstore] Collection '{self.collection_name}' ready.")
        print(f"[vectorstore] Existing docs: {self.collection.count()}")

    # ── Write ──────────────────────────────────────────────────────────────────
    def add_documents(
        self,
        documents,
        embeddings: np.ndarray,
    ) -> int:
        """
        Store chunks + their embeddings in ChromaDB.

        Args:
            documents  : List[Document] from ingestion.py
            embeddings : np.ndarray shape (n, 384)

        Returns:
            Number of chunks added.
        """
        if len(documents) != len(embeddings):
            raise ValueError("documents and embeddings length mismatch")

        ids, metas, texts, vecs = [], [], [], []

        for i, (doc, emb) in enumerate(zip(documents, embeddings)):
            doc_id = f"doc_{uuid.uuid4().hex[:8]}_{i}"
            ids.append(doc_id)

            meta = dict(doc.metadata)
            meta["content_length"] = len(doc.page_content)
            metas.append(meta)

            texts.append(doc.page_content)
            vecs.append(emb.tolist())

        # ChromaDB rejects writes larger than its configured max batch size.  A
        # full-folder ingest can easily exceed that limit, so write the prepared
        # payload in batches.  Querying the client keeps this compatible with
        # custom ChromaDB configurations; the fallback supports older versions.
        try:
            batch_size = self.client.get_max_batch_size()
        except (AttributeError, TypeError):
            batch_size = DEFAULT_WRITE_BATCH_SIZE

        if not isinstance(batch_size, int) or batch_size < 1:
            batch_size = DEFAULT_WRITE_BATCH_SIZE

        for start in range(0, len(ids), batch_size):
            end = start + batch_size
            self.collection.add(
                ids=ids[start:end],
                embeddings=vecs[start:end],
                metadatas=metas[start:end],
                documents=texts[start:end],
            )

        added = len(documents)
        print(f"[vectorstore] Added {added} chunks. Total: {self.collection.count()}")
        return added

    # ── Read ───────────────────────────────────────────────────────────────────
    def semantic_search(
        self,
        query: str,
        top_k: int = 5,
        score_threshold: float = 0.0,
        source_filter: str | None = None,
    ) -> List[Dict[str, Any]]:
        """
        Search for chunks semantically similar to query.

        Args:
            query           : Natural language query
            top_k           : Max results to return
            score_threshold : Min similarity score (0.0 = return all)
            source_filter   : Filter by source_file name (optional)

        Returns:
            List of dicts — each has:
                content, metadata, similarity_score, distance, rank
        """
        # Embed the query using same model
        model         = get_embedding_model()
        query_vector  = model.encode([query])[0].tolist()

        # Build optional where filter
        where = {"source_file": source_filter} if source_filter else None

        try:
            results = self.collection.query(
                query_embeddings=[query_vector],
                n_results=min(top_k, self.collection.count()) or 1,
                where=where,
            )
        except Exception as e:
            print(f"[vectorstore] Query error: {e}")
            return []

        retrieved = []
        if results["documents"] and results["documents"][0]:
            for rank, (doc_id, content, meta, dist) in enumerate(
                zip(
                    results["ids"][0],
                    results["documents"][0],
                    results["metadatas"][0],
                    results["distances"][0],
                ),
                start=1,
            ):
                score = 1.0 - dist  # ChromaDB returns cosine distance
                if score >= score_threshold:
                    retrieved.append(
                        {
                            "id":               doc_id,
                            "content":          content,
                            "metadata":         meta,
                            "similarity_score": round(score, 4),
                            "distance":         round(dist, 4),
                            "rank":             rank,
                        }
                    )

        print(f"[vectorstore] Query '{query[:50]}...' → {len(retrieved)} results")
        return retrieved

    def hybrid_search(
        self,
        query: str,
        top_k: int = 5,
        score_threshold: float = 0.0,
        source_filter: str | None = None,
    ) -> List[Dict[str, Any]]:
        """
        Fast hybrid search: Dense (ChromaDB) + Sparse (BM25) fused via RRF.

        KEY OPTIMIZATION: BM25 runs only on the dense candidate pool (top_k*4),
        NOT on all documents in the collection. This keeps latency O(top_k)
        instead of O(n_docs), which matters a lot at 5k+ chunks.
        """
        if self.collection.count() == 0:
            return []

        # 1. Dense retrieval — fetch a larger candidate pool for reranking
        candidate_k = min(top_k * 4, self.collection.count())
        dense_results = self.semantic_search(
            query, top_k=candidate_k,
            score_threshold=score_threshold,
            source_filter=source_filter,
        )

        if not dense_results:
            return []

        # 2. BM25 on the dense candidate pool only (fast — no full-collection scan)
        query_tokens  = tokenize(query)
        corpus_texts  = [r["content"] for r in dense_results]
        corpus_tokens = [tokenize(t) for t in corpus_texts]

        bm25   = SimpleBM25(corpus_tokens)
        scores = bm25.get_scores(query_tokens)

        # Build sparse ranking from candidate pool
        sparse_ranked = sorted(
            [(dense_results[i]["id"], scores[i]) for i in range(len(dense_results)) if scores[i] > 0],
            key=lambda x: x[1], reverse=True,
        )

        # 3. Reciprocal Rank Fusion
        k          = 60
        rrf_scores = {}
        doc_map    = {r["id"]: r for r in dense_results}

        for rank, item in enumerate(dense_results, start=1):
            did = item["id"]
            rrf_scores[did] = rrf_scores.get(did, 0.0) + 1.0 / (k + rank)

        for rank, (did, _) in enumerate(sparse_ranked, start=1):
            rrf_scores[did] = rrf_scores.get(did, 0.0) + 1.0 / (k + rank)

        sorted_ids = sorted(rrf_scores, key=lambda x: rrf_scores[x], reverse=True)

        retrieved = []
        for rank, did in enumerate(sorted_ids[:top_k], start=1):
            d = doc_map[did]
            retrieved.append({
                "id":               d["id"],
                "content":          d["content"],
                "metadata":         d["metadata"],
                "similarity_score": d["similarity_score"],
                "rrf_score":        round(rrf_scores[did], 6),
                "rank":             rank,
            })

        print(f"[vectorstore] Hybrid '{query[:50]}...' → {len(retrieved)} results (pool={len(dense_results)})")
        return retrieved

    # ── Utility ────────────────────────────────────────────────────────────────
    def list_papers(self) -> List[str]:
        """
        Return unique paper filenames currently in the store.
        Used by api.py GET /papers endpoint.
        """
        if self.collection.count() == 0:
            return []

        total = self.collection.count()
        papers = set()

        # Calling get() without a limit makes ChromaDB build an oversized SQLite
        # query once the collection has thousands of chunks.  Page through the
        # metadata instead; only filenames are needed for this endpoint.
        for offset in range(0, total, METADATA_READ_BATCH_SIZE):
            result = self.collection.get(
                include=["metadatas"],
                limit=METADATA_READ_BATCH_SIZE,
                offset=offset,
            )
            papers.update(
                metadata.get("source_file", "unknown")
                for metadata in result.get("metadatas", [])
                if metadata
            )

        return sorted(papers)

    def count(self) -> int:
        """Total chunks stored."""
        return self.collection.count()

    def delete_collection(self):
        """
        Wipe entire collection (useful for re-ingesting fresh).
        Recreates empty collection after deletion.
        """
        self.client.delete_collection(self.collection_name)
        self.collection = self.client.get_or_create_collection(
            name=self.collection_name,
            metadata={"description": "ArXiv paper embeddings for RAG"},
        )
        print(f"[vectorstore] Collection reset. Count: {self.collection.count()}")

    def __repr__(self):
        return (
            f"VectorStore(collection='{self.collection_name}', "
            f"docs={self.collection.count()}, "
            f"path='{self.persist_directory}')"
        )


# ── Singleton getter (used by tools.py and api.py) ────────────────────────────
_vectorstore_instance: VectorStore | None = None

def get_vectorstore() -> VectorStore:
    """
    Return a single shared VectorStore instance.
    Avoids re-opening ChromaDB on every tool call.
    """
    global _vectorstore_instance
    if _vectorstore_instance is None:
        _vectorstore_instance = VectorStore()
    return _vectorstore_instance


# ── Quick test ─────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    vs = get_vectorstore()
    print(vs)
    print("Papers:", vs.list_papers())

    # Test search if data exists
    if vs.count() > 0:
        results = vs.semantic_search("attention mechanism transformer", top_k=3)
        for r in results:
            print(f"\nRank {r['rank']} | Score: {r['similarity_score']}")
            print(f"Source: {r['metadata'].get('source_file')} | Page: {r['metadata'].get('page')}")
            print(f"Content: {r['content'][:200]}...")
