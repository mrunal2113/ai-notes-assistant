# Personal AI Knowledge Assistant

A local-first RAG project that lets you add personal notes or documents, builds a private vector index, and answers questions with citations from your own knowledge base.

## Features

1.Local document ingestion from pasted text or `.txt`, `.md`, `.csv`, and `.json` files
2.Chunking and hashed vector embeddings for private semantic search
3.Persistent local JSON knowledge base
4.Retrieval-augmented chat with cited source snippets
5.Source management with document and chunk counts
6.No package install required

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
