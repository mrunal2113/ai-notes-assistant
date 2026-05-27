# Personal AI Knowledge Assistant

A local-first RAG project that lets you add personal notes or documents, builds a private vector index, and answers questions with citations from your own knowledge base.

## Features

- Local document ingestion from pasted text or `.txt`, `.md`, `.csv`, and `.json` files
- Chunking and hashed vector embeddings for private semantic search
- Persistent local JSON knowledge base
- Retrieval-augmented chat with cited source snippets
- Source management with document and chunk counts
- No package install required

## Run

```powershell
node server.js
```

Then open:

```text
http://localhost:3000
```

If the `node` command is not available, use the included launcher:

```powershell
.\run.ps1
```

If port `3000` is busy:

```powershell
$env:PORT=3100; node server.js
```

## How It Works

1. Text is cleaned and split into overlapping chunks.
2. Each chunk is embedded into a fixed-size vector using a hashing trick.
3. Vectors are saved in `data/knowledge-base.json`.
4. A user question is embedded the same way.
5. The server retrieves the most similar chunks with cosine similarity.
6. The answer composer summarizes the strongest matching sentences and attaches citations.

## Privacy

Everything runs locally. Documents are stored only in the local `data` folder created by the app. No external API is required.

## Resume Talking Points

- Built a vector-search-backed personal knowledge assistant from scratch
- Implemented retrieval-augmented generation flow with chunking, embeddings, cosine similarity, and citations
- Designed local-first storage for personal-data privacy
- Created a clean chat interface and document-ingestion workflow
