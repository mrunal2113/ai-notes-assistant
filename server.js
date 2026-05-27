const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "knowledge-base.json");
const VECTOR_SIZE = 384;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function ensureDatabase() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DB_PATH)) {
    writeDatabase({ documents: [], chunks: [], createdAt: new Date().toISOString() });
  }
}

function readDatabase() {
  ensureDatabase();
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function writeDatabase(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 5_000_000) {
        req.destroy();
        reject(new Error("Request body is too large."));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function tokenize(text) {
  return normalizeText(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

function hashToken(token) {
  const hex = crypto.createHash("sha256").update(token).digest("hex").slice(0, 8);
  return parseInt(hex, 16);
}

function embed(text) {
  const vector = new Array(VECTOR_SIZE).fill(0);
  const tokens = tokenize(text);

  for (const token of tokens) {
    const hash = hashToken(token);
    const index = hash % VECTOR_SIZE;
    const sign = hash % 2 === 0 ? 1 : -1;
    vector[index] += sign;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => Number((value / magnitude).toFixed(6)));
}

function cosineSimilarity(a, b) {
  let score = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    score += a[i] * b[i];
  }
  return score;
}

function overlapRatio(queryTokens, candidateTokens) {
  if (queryTokens.length === 0) {
    return 0;
  }

  const candidateSet = new Set(candidateTokens);
  const overlap = queryTokens.filter((token) => candidateSet.has(token)).length;
  return overlap / queryTokens.length;
}

function chunkText(text, size = 900, overlap = 160) {
  const clean = normalizeText(text);
  const paragraphs = clean.split(/\n\s*\n/).filter(Boolean);
  const chunks = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length <= size) {
      current = next;
      continue;
    }

    if (current) {
      chunks.push(current);
    }

    if (paragraph.length <= size) {
      current = paragraph;
      continue;
    }

    for (let start = 0; start < paragraph.length; start += size - overlap) {
      chunks.push(paragraph.slice(start, start + size));
    }
    current = "";
  }

  if (current) {
    chunks.push(current);
  }

  return chunks
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 30);
}

function createDocument({ title, text }) {
  const cleanTitle = normalizeText(title) || `Untitled ${new Date().toLocaleString()}`;
  const cleanText = normalizeText(text);

  if (cleanText.length < 40) {
    throw new Error("Add at least 40 characters of useful text.");
  }

  const documentId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const chunks = chunkText(cleanText).map((content, index) => ({
    id: crypto.randomUUID(),
    documentId,
    title: cleanTitle,
    content,
    index,
    vector: embed(content),
    createdAt,
  }));

  return {
    document: {
      id: documentId,
      title: cleanTitle,
      createdAt,
      characterCount: cleanText.length,
      chunkCount: chunks.length,
    },
    chunks,
  };
}

function searchKnowledge(question, db, limit = 5) {
  const queryVector = embed(question);
  const queryTokens = tokenize(question);

  const scored = db.chunks
    .map((chunk) => ({
      ...chunk,
      semanticScore: cosineSimilarity(queryVector, chunk.vector),
      lexicalScore: overlapRatio(queryTokens, tokenize(chunk.content)),
      titleScore: overlapRatio(queryTokens, tokenize(chunk.title)),
    }))
    .map((chunk) => ({
      ...chunk,
      score: chunk.semanticScore * 0.7 + chunk.lexicalScore * 0.25 + chunk.titleScore * 0.05,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .filter((chunk) => chunk.score > 0.03 || chunk.lexicalScore > 0);

  return scored;
}

function isMetadataIntent(question) {
  const q = question.toLowerCase();
  const asksAboutTitle = /(^|\s)(title|name|heading)(\s|$)/.test(q);
  const asksAboutSource = /(^|\s)(source|document|file|doc)(s)?(\s|$)/.test(q);
  const asksToList = /(^|\s)(list|show|which|what are|what is)(\s|$)/.test(q);
  const asksAboutCurrent = /(^|\s)(this|that|current|uploaded)(\s|$)/.test(q);

  return asksAboutTitle || asksAboutSource || (asksToList && asksAboutCurrent);
}

function answerFromMetadata(question, documents) {
  if (documents.length === 0) {
    return {
      answer: "No documents are indexed yet. Add a source first, then I can reference its title and content.",
      citations: [],
    };
  }

  if (documents.length === 1) {
    const doc = documents[0];
    return {
      answer: `Your current document title is "${doc.title}". It has ${doc.chunkCount} chunks and ${doc.characterCount} characters.`,
      citations: [],
    };
  }

  const names = documents.slice(0, 5).map((doc) => doc.title).join(", ");
  const lowerQuestion = question.toLowerCase();
  if (lowerQuestion.includes("title") || lowerQuestion.includes("name")) {
    return {
      answer: `You currently have ${documents.length} documents. Titles include: ${names}. Ask me about one by title for a focused answer.`,
      citations: [],
    };
  }

  return {
    answer: `You currently have ${documents.length} documents. Latest sources: ${names}. Ask a question tied to one source or across all notes.`,
    citations: [],
  };
}

function composeAnswer(question, matches) {
  if (matches.length === 0) {
    return {
      answer:
        "I could not find enough relevant information in your knowledge base yet. Add more notes or documents, then ask again.",
      citations: [],
    };
  }

  const keywords = new Set(tokenize(question));
  const selectedSentences = [];

  for (const [matchIndex, match] of matches.entries()) {
    const sentences = match.content
      .split(/(?<=[.!?])\s+|\n+/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length > 20);

    const rankedSentences = sentences
      .map((sentence) => {
        const sentenceTokens = tokenize(sentence);
        const overlap = sentenceTokens.filter((token) => keywords.has(token)).length;
        return { sentence, overlap };
      })
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, 2);

    for (const item of rankedSentences) {
      if (selectedSentences.length >= 5) {
        break;
      }

      selectedSentences.push({
        text: item.sentence,
        sourceId: match.id,
        title: match.title,
        citationNumber: matchIndex + 1,
      });
    }
  }

  const uniqueSentences = [];
  const seen = new Set();

  for (const sentence of selectedSentences) {
    const key = sentence.text.toLowerCase();
    if (!seen.has(key)) {
      uniqueSentences.push(sentence);
      seen.add(key);
    }
  }

  const answer = uniqueSentences
    .map((sentence) => `${sentence.text} [${sentence.citationNumber}]`)
    .join(" ");

  return {
    answer:
      answer ||
      "I found related notes, but they did not contain a clean sentence-level answer. Check the cited sources below for the closest context.",
    citations: matches.map((match, index) => ({
      number: index + 1,
      id: match.id,
      title: match.title,
      score: Number(match.score.toFixed(3)),
      excerpt: match.content.slice(0, 420),
    })),
  };
}

function getStats() {
  const db = readDatabase();
  return {
    documents: db.documents.length,
    chunks: db.chunks.length,
    characters: db.documents.reduce((sum, doc) => sum + doc.characterCount, 0),
  };
}

async function handleApi(req, res) {
  if (req.method === "GET" && req.url === "/api/stats") {
    return sendJson(res, 200, getStats());
  }

  if (req.method === "GET" && req.url === "/api/documents") {
    const db = readDatabase();
    return sendJson(res, 200, { documents: db.documents });
  }

  if (req.method === "POST" && req.url === "/api/documents") {
    try {
      const payload = JSON.parse(await readRequestBody(req));
      const created = createDocument(payload);
      const db = readDatabase();
      db.documents.unshift(created.document);
      db.chunks.push(...created.chunks);
      db.updatedAt = new Date().toISOString();
      writeDatabase(db);

      return sendJson(res, 201, {
        document: created.document,
        stats: getStats(),
      });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (req.method === "DELETE" && req.url.startsWith("/api/documents/")) {
    const documentId = decodeURIComponent(req.url.split("/").pop());
    const db = readDatabase();
    const documentExists = db.documents.some((doc) => doc.id === documentId);

    if (!documentExists) {
      return sendJson(res, 404, { error: "Document not found." });
    }

    db.documents = db.documents.filter((doc) => doc.id !== documentId);
    db.chunks = db.chunks.filter((chunk) => chunk.documentId !== documentId);
    db.updatedAt = new Date().toISOString();
    writeDatabase(db);

    return sendJson(res, 200, { ok: true, stats: getStats() });
  }

  if (req.method === "POST" && req.url === "/api/chat") {
    try {
      const payload = JSON.parse(await readRequestBody(req));
      const question = normalizeText(payload.question);
      const db = readDatabase();

      if (question.length < 3) {
        return sendJson(res, 400, { error: "Ask a longer question." });
      }

      if (isMetadataIntent(question)) {
        return sendJson(res, 200, {
          question,
          ...answerFromMetadata(question, db.documents),
        });
      }

      const matches = searchKnowledge(question, db, 5);
      return sendJson(res, 200, {
        question,
        ...composeAnswer(question, matches),
      });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  return sendJson(res, 404, { error: "API route not found." });
}

function serveStatic(req, res) {
  const requestPath = req.url === "/" ? "/index.html" : decodeURIComponent(req.url.split("?")[0]);
  const normalized = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, normalized);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const extension = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
    });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    handleApi(req, res);
    return;
  }

  serveStatic(req, res);
});

ensureDatabase();
server.listen(PORT, () => {
  console.log(`Personal AI Knowledge Assistant running at http://localhost:${PORT}`);
});

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "are",
  "but",
  "not",
  "you",
  "your",
  "with",
  "that",
  "this",
  "from",
  "have",
  "has",
  "had",
  "was",
  "were",
  "will",
  "would",
  "can",
  "could",
  "should",
  "into",
  "about",
  "what",
  "when",
  "where",
  "why",
  "how",
  "who",
  "which",
  "their",
  "there",
  "then",
  "than",
  "them",
  "they",
  "its",
  "our",
  "out",
  "use",
  "using",
]);
