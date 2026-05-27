const elements = {
  documentCount: document.querySelector("#documentCount"),
  chunkCount: document.querySelector("#chunkCount"),
  characterCount: document.querySelector("#characterCount"),
  docTitle: document.querySelector("#docTitle"),
  docText: document.querySelector("#docText"),
  fileInput: document.querySelector("#fileInput"),
  saveDocButton: document.querySelector("#saveDocButton"),
  ingestStatus: document.querySelector("#ingestStatus"),
  refreshButton: document.querySelector("#refreshButton"),
  sourceList: document.querySelector("#sourceList"),
  messages: document.querySelector("#messages"),
  chatForm: document.querySelector("#chatForm"),
  questionInput: document.querySelector("#questionInput"),
};

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Something went wrong.");
  }

  return payload;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-IN").format(value || 0);
}

function setStatus(message, tone = "neutral") {
  elements.ingestStatus.textContent = message;
  elements.ingestStatus.style.color =
    tone === "error" ? "#a12525" : tone === "success" ? "#0f5f58" : "#62727f";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function loadStats() {
  const stats = await requestJson("/api/stats");
  elements.documentCount.textContent = formatNumber(stats.documents);
  elements.chunkCount.textContent = formatNumber(stats.chunks);
  elements.characterCount.textContent = formatNumber(stats.characters);
}

async function loadDocuments() {
  const { documents } = await requestJson("/api/documents");

  if (documents.length === 0) {
    elements.sourceList.innerHTML = '<p class="empty-state">No sources added yet.</p>';
    return;
  }

  elements.sourceList.innerHTML = documents
    .map(
      (doc) => `
        <article class="source-item">
          <div>
            <strong title="${escapeHtml(doc.title)}">${escapeHtml(doc.title)}</strong>
            <span>${formatNumber(doc.characterCount)} chars · ${formatNumber(doc.chunkCount)} chunks</span>
          </div>
          <button class="delete-button" type="button" data-document-id="${doc.id}" aria-label="Delete ${escapeHtml(
            doc.title,
          )}">×</button>
        </article>
      `,
    )
    .join("");
}

async function refreshAll() {
  await Promise.all([loadStats(), loadDocuments()]);
}

async function addDocument() {
  const title = elements.docTitle.value.trim();
  const text = elements.docText.value.trim();

  elements.saveDocButton.disabled = true;
  setStatus("Indexing document...");

  try {
    const result = await requestJson("/api/documents", {
      method: "POST",
      body: JSON.stringify({ title, text }),
    });

    elements.docTitle.value = "";
    elements.docText.value = "";
    elements.fileInput.value = "";
    setStatus(`Added "${result.document.title}" with ${result.document.chunkCount} chunks.`, "success");
    await refreshAll();
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    elements.saveDocButton.disabled = false;
  }
}

async function deleteDocument(documentId) {
  await requestJson(`/api/documents/${encodeURIComponent(documentId)}`, { method: "DELETE" });
  await refreshAll();
}

function appendMessage(role, content, citations = []) {
  const article = document.createElement("article");
  article.className = `message ${role}`;
  const avatar = role === "user" ? "U" : "K";

  const citationHtml = citations.length
    ? `
      <div class="citations">
        ${citations
          .map(
            (citation, index) => `
              <div class="citation">
                <strong>[${citation.number || index + 1}] ${escapeHtml(citation.title)}</strong>
                <small>Similarity ${escapeHtml(citation.score)}</small>
                <p>${escapeHtml(citation.excerpt)}${citation.excerpt.length >= 420 ? "..." : ""}</p>
              </div>
            `,
          )
          .join("")}
      </div>
    `
    : "";

  article.innerHTML = `
    <div class="avatar">${avatar}</div>
    <div class="bubble">
      <p>${escapeHtml(content)}</p>
      ${citationHtml}
    </div>
  `;

  elements.messages.appendChild(article);
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

async function askQuestion(event) {
  event.preventDefault();
  const question = elements.questionInput.value.trim();

  if (!question) {
    return;
  }

  appendMessage("user", question);
  elements.questionInput.value = "";
  elements.questionInput.disabled = true;

  try {
    const response = await requestJson("/api/chat", {
      method: "POST",
      body: JSON.stringify({ question }),
    });
    appendMessage("assistant", response.answer, response.citations);
  } catch (error) {
    appendMessage("assistant", error.message);
  } finally {
    elements.questionInput.disabled = false;
    elements.questionInput.focus();
  }
}

elements.fileInput.addEventListener("change", async (event) => {
  const file = event.target.files[0];

  if (!file) {
    return;
  }

  const text = await file.text();
  elements.docText.value = text;

  if (!elements.docTitle.value.trim()) {
    elements.docTitle.value = file.name.replace(/\.[^.]+$/, "");
  }

  setStatus(`Loaded ${file.name}. Review it, then add it to the knowledge base.`);
});

elements.saveDocButton.addEventListener("click", addDocument);
elements.refreshButton.addEventListener("click", refreshAll);
elements.chatForm.addEventListener("submit", askQuestion);
elements.sourceList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-document-id]");
  if (button) {
    await deleteDocument(button.dataset.documentId);
  }
});

refreshAll().catch((error) => {
  setStatus(error.message, "error");
});
