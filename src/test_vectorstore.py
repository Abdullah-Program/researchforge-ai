"""Regression tests for ChromaDB write batching."""

import numpy as np

from vectorstore import VectorStore


class FakeDocument:
    def __init__(self, index: int):
        self.page_content = f"chunk {index}"
        self.metadata = {"source_file": "paper.pdf", "chunk_index": index}


class FakeClient:
    def get_max_batch_size(self):
        return 5_461


class FakeCollection:
    def __init__(self):
        self.batches = []

    def add(self, **payload):
        self.batches.append(payload)

    def count(self):
        return sum(len(batch["ids"]) for batch in self.batches)


class PagedMetadataCollection:
    def __init__(self, metadata):
        self.metadata = metadata
        self.requests = []

    def count(self):
        return len(self.metadata)

    def get(self, *, include, limit, offset):
        self.requests.append((include, limit, offset))
        return {"metadatas": self.metadata[offset:offset + limit]}


def test_add_documents_splits_payload_at_chroma_limit():
    store = VectorStore.__new__(VectorStore)
    store.client = FakeClient()
    store.collection = FakeCollection()
    documents = [FakeDocument(i) for i in range(5_692)]
    embeddings = np.zeros((5_692, 2), dtype=np.float32)

    assert store.add_documents(documents, embeddings) == 5_692
    assert [len(batch["ids"]) for batch in store.collection.batches] == [5_461, 231]
    assert store.collection.count() == 5_692


def test_list_papers_pages_large_metadata_reads():
    store = VectorStore.__new__(VectorStore)
    store.collection = PagedMetadataCollection(
        [{"source_file": f"paper-{i % 3}.pdf"} for i in range(2_001)]
    )

    assert store.list_papers() == ["paper-0.pdf", "paper-1.pdf", "paper-2.pdf"]
    assert [request[2] for request in store.collection.requests] == [0, 1_000, 2_000]
