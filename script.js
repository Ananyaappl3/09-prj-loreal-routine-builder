/* Get references to DOM elements */
const categoryFilter = document.getElementById("categoryFilter");
const productsContainer = document.getElementById("productsContainer");
const chatForm = document.getElementById("chatForm");
const chatWindow = document.getElementById("chatWindow");
const selectedProductsList = document.getElementById("selectedProductsList");
const generateRoutineBtn = document.getElementById("generateRoutine");
// conversation state so user can continue chatting after generation
let conversationMessages = [];

/* -- Chat / UI helpers -- */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function appendChatMessage(role, text) {
  const wrap = document.createElement("div");
  wrap.className = `chat-msg ${role}`;
  if (role === "user") {
    wrap.innerHTML = `<div class="chat-user">${escapeHtml(text)}</div>`;
  } else {
    wrap.innerHTML = `<div class="chat-assistant">${text}</div>`;
  }
  chatWindow.appendChild(wrap);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function appendChatHtml(html) {
  const wrap = document.createElement("div");
  wrap.className = "chat-html";
  wrap.innerHTML = html;
  chatWindow.appendChild(wrap);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

// Try to extract JSON from text replies (direct JSON, fenced code block, or first {...}..}
function tryExtractJson(text) {
  if (!text) return null;
  // direct parse
  try {
    return JSON.parse(text);
  } catch (e) {}

  // fenced block ```json ... ```
  const fence = text.match(/```(?:json)?\n([\s\S]*?)\n```/i);
  if (fence && fence[1]) {
    try {
      return JSON.parse(fence[1]);
    } catch (e) {}
  }

  // fallback: try to find first {...}
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    const candidate = text.substring(first, last + 1);
    try {
      return JSON.parse(candidate);
    } catch (e) {}
  }
  return null;
}

function renderRoutineAsHtml(parsed) {
  let content = "";
  if (parsed.title) content += `<h3>${escapeHtml(parsed.title)}</h3>`;
  if (parsed.routine && Array.isArray(parsed.routine)) {
    content += "<ol class='routine-steps'>";
    parsed.routine.forEach((step) => {
      if (typeof step === "string") {
        content += `<li>${escapeHtml(step)}</li>`;
      } else if (typeof step === "object") {
        const title = step.title || step.step || "";
        const instr =
          step.instruction || step.instruction_text || step.text || "";
        content += `<li><strong>${escapeHtml(title)}</strong>: ${escapeHtml(
          instr
        )}</li>`;
      }
    });
    content += "</ol>";
  } else {
    content += `<pre>${escapeHtml(JSON.stringify(parsed, null, 2))}</pre>`;
  }

  return `<div class="chat-msg assistant"><div class="chat-assistant">${content}</div></div>`;
}

// Send follow-up user message using conversationMessages context
async function sendChatMessage(messageText) {
  // append user message to UI and conversation
  appendChatMessage("user", messageText);
  conversationMessages.push({ role: "user", content: messageText });

  // prepare request body
  const body = { model: "gpt-4o", messages: conversationMessages };

  try {
    const res = await fetch(
      "https://ananya-cloudflare-first.asbasark.workers.dev/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );

    const data = await res.json();
    const reply =
      data?.choices?.[0]?.message?.content || JSON.stringify(data, null, 2);
    conversationMessages.push({ role: "assistant", content: reply });
    // try to parse JSON; otherwise show as assistant text
    const parsed = tryExtractJson(reply);
    if (parsed && parsed.routine) {
      appendChatHtml(renderRoutineAsHtml(parsed));
    } else {
      appendChatMessage("assistant", reply);
    }
  } catch (err) {
    appendChatHtml(`<div class="error">${escapeHtml(String(err))}</div>`);
  }
}

// wire chat form to allow follow-up questions
chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const input = document.getElementById("userInput").value.trim();
  if (!input) return;
  document.getElementById("userInput").value = "";
  sendChatMessage(input);
});
/* Show initial placeholder until user selects a category */
productsContainer.innerHTML = `
  <div class="placeholder-message">
    Select a category to view products
  </div>
`;

/* Load product data from JSON file */
async function loadProducts() {
  const response = await fetch("products.json");
  const data = await response.json();
  return data.products;
}

/* Create HTML for displaying product cards */
function displayProducts(products) {
  productsContainer.innerHTML = products
    .map(
      (product) => `
        <div class="product-card" data-id="${product.id}" data-name="${
        product.name
      }" data-brand="${product.brand}" data-image="${
        product.image
      }" data-description="${product.description.replace(/"/g, "&quot;")}">
          <img src="${product.image}" alt="${product.name}">
          <div class="product-info">
            <h3>${product.name}</h3>
            <p>${product.brand}</p>
          </div>
          <div class="card-overlay" aria-hidden="true">
            <h4 class="overlay-title">${product.name}</h4>
            <p class="overlay-desc">${product.description}</p>
          </div>
        </div>
      `
    )
    .join("");

  // After rendering, attach selection and keyboard handlers to each card
  makeCardsSelectable();
  // restore any selections stored in localStorage
  restoreSelections();
}

/* Make rendered product cards selectable via mouse and keyboard */
function makeCardsSelectable() {
  const cards = document.querySelectorAll(".product-card");
  cards.forEach((card) => {
    // Accessibility: make card focusable and announceable as a button
    card.setAttribute("tabindex", "0");
    card.setAttribute("role", "button");
    card.setAttribute("aria-pressed", "false");

    // Click toggles selection and updates selected-products list
    card.addEventListener("click", () => {
      const isSelected = card.classList.toggle("selected");
      card.setAttribute("aria-pressed", isSelected.toString());

      const product = {
        id: card.getAttribute("data-id"),
        name: card.getAttribute("data-name"),
        brand: card.getAttribute("data-brand"),
        image: card.getAttribute("data-image"),
      };

      if (isSelected) {
        addSelectedProduct(product);
      } else {
        removeSelectedProduct(product.id);
      }
    });

    // Keyboard support: Enter or Space should activate the card
    card.addEventListener("keydown", (e) => {
      const key = e.key || e.keyCode;
      if (
        key === "Enter" ||
        key === " " ||
        key === "Spacebar" ||
        key === 13 ||
        key === 32
      ) {
        e.preventDefault();
        card.click();
      }
    });
  });
}
/* Filter and display products when category changes */
categoryFilter.addEventListener("change", async (e) => {
  const products = await loadProducts();
  const selectedCategory = e.target.value;

  /* filter() creates a new array containing only products 
     where the category matches what the user selected */
  const filteredProducts = products.filter(
    (product) => product.category === selectedCategory
  );

  displayProducts(filteredProducts);
});

/* Add a product to the Selected Products list (if not already present) */
function addSelectedProduct(product) {
  // Prevent duplicates
  if (selectedProductsList.querySelector(`[data-id="${product.id}"]`)) return;

  const item = document.createElement("div");
  item.className = "selected-item";
  item.setAttribute("data-id", product.id);
  item.innerHTML = `
    <img src="${product.image}" alt="${product.name}" class="selected-thumb">
    <div class="selected-info">
      <strong>${product.name}</strong>
      <div class="small">${product.brand}</div>
    </div>
    <button class="remove-selected" aria-label="Remove ${product.name}" data-id="${product.id}">&times;</button>
  `;

  // Remove handler for the small remove button
  const removeBtn = item.querySelector(".remove-selected");
  removeBtn.addEventListener("click", () => removeSelectedProduct(product.id));

  selectedProductsList.appendChild(item);
  // persist selection
  saveSelectedIds();
}

/* Remove a product from the Selected Products list and update grid */
function removeSelectedProduct(id) {
  // Remove from selected-products list
  const selectedItem = selectedProductsList.querySelector(`[data-id="${id}"]`);
  if (selectedItem) selectedItem.remove();

  // Update the grid card if present
  const gridCard = document.querySelector(`.product-card[data-id="${id}"]`);
  if (gridCard && gridCard.classList.contains("selected")) {
    gridCard.classList.remove("selected");
    gridCard.setAttribute("aria-pressed", "false");
  }
  // persist selection changes
  saveSelectedIds();
}

/* --- Persistence: save selected product ids to localStorage --- */
function getStoredSelectedIds() {
  try {
    const raw = localStorage.getItem("selectedProducts");
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function saveSelectedIds() {
  const ids = Array.from(
    selectedProductsList.querySelectorAll("[data-id]")
  ).map((el) => el.getAttribute("data-id"));
  localStorage.setItem("selectedProducts", JSON.stringify(ids));
}

// Restore selections for visible grid cards and populate selected list from storage
function restoreSelections() {
  const ids = getStoredSelectedIds();
  if (!ids.length) return;

  // mark visible cards
  ids.forEach((id) => {
    const card = document.querySelector(`.product-card[data-id="${id}"]`);
    if (card) {
      if (!card.classList.contains("selected")) {
        card.classList.add("selected");
        card.setAttribute("aria-pressed", "true");
      }
    }
  });

  // Ensure selectedProductsList contains the stored items (load product data to get details)
  loadProducts().then((all) => {
    ids.forEach((id) => {
      // avoid duplicates in list
      if (selectedProductsList.querySelector(`[data-id="${id}"]`)) return;
      const p = all.find((x) => String(x.id) === String(id));
      if (p)
        addSelectedProduct({
          id: String(p.id),
          name: p.name,
          brand: p.brand,
          image: p.image,
        });
    });
  });
}

// Generate routine from selected products and append assistant reply to chat history
async function generateRoutine() {
  // collect selected product ids from selectedProductsList (preserves order)
  const selectedEls = Array.from(
    selectedProductsList.querySelectorAll("[data-id]")
  );
  const selectedIds = selectedEls.map((el) => el.getAttribute("data-id"));

  if (!selectedIds.length) {
    appendChatHtml(
      `<div class="error">Please select at least one product before generating a routine.</div>`
    );
    return;
  }

  // load full product data
  const all = await loadProducts();
  const selectedProducts = all.filter((p) =>
    selectedIds.includes(String(p.id))
  );

  // build system/user messages
  const systemMessage = {
    role: "system",
    content:
      'You are a helpful L\'Oreal assistant. When asked to generate a routine, RETURN ONLY valid JSON following this schema: { "title": string (optional), "routine": [ { "title": string, "instruction": string } ], "notes": string (optional) }. If no routine can be made, return { "routine": [] }. Do not include extra text outside the JSON. You may also be asked about specific products or questions about skincare, fragrances, makeup or related things. Be concise, polite and helpful when answering these questions.',
  };

  const userMessage = {
    role: "user",
    content: `Generate a routine using these selected products (JSON): ${JSON.stringify(
      selectedProducts
    )}`,
  };

  // ensure system at start of conversationMessages
  if (
    !conversationMessages ||
    conversationMessages.length === 0 ||
    conversationMessages[0].role !== "system"
  ) {
    conversationMessages = [systemMessage];
  }

  // push the user message to conversation and UI
  conversationMessages.push(userMessage);
  appendChatMessage("user", "Generate routine for selected products.");

  // UI feedback
  const orig = generateRoutineBtn.innerHTML;
  generateRoutineBtn.disabled = true;
  generateRoutineBtn.innerText = "Generating…";

  try {
    const body = {
      model: "gpt-4o",
      messages: conversationMessages,
      max_tokens: 800,
      temperature: 0.7,
    };
    const res = await fetch(
      "https://ananya-cloudflare-first.asbasark.workers.dev/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `API error ${res.status}`);
    }
    const data = await res.json();
    const reply =
      data?.choices?.[0]?.message?.content || JSON.stringify(data, null, 2);

    // push assistant reply to conversation
    conversationMessages.push({ role: "assistant", content: reply });

    // try to parse JSON routine
    const parsed = tryExtractJson(reply);
    if (parsed && parsed.routine && Array.isArray(parsed.routine)) {
      appendChatHtml(renderRoutineAsHtml(parsed));
      if (parsed.notes)
        appendChatHtml(
          `<div class="assistant-notes"><strong>Notes:</strong> ${escapeHtml(
            parsed.notes
          )}</div>`
        );
    } else {
      // fallback: show assistant raw reply
      appendChatMessage("assistant", reply);
    }
  } catch (err) {
    appendChatHtml(`<div class="error">${escapeHtml(String(err))}</div>`);
  } finally {
    generateRoutineBtn.disabled = false;
    generateRoutineBtn.innerHTML = orig;
  }
}

// Wire the generate button
generateRoutineBtn.addEventListener("click", () => generateRoutine());

// Wire clear selections button
const clearSelectionsBtn = document.getElementById("clearSelections");
if (clearSelectionsBtn) {
  clearSelectionsBtn.addEventListener("click", () => {
    // remove all selected items from UI
    selectedProductsList
      .querySelectorAll("[data-id]")
      .forEach((el) => el.remove());
    // remove selection class from any grid cards
    document.querySelectorAll(".product-card.selected").forEach((c) => {
      c.classList.remove("selected");
      c.setAttribute("aria-pressed", "false");
    });
    // clear storage
    localStorage.removeItem("selectedProducts");
  });
}

// On load, restore any persisted selections so they persist across refreshes
restoreSelections();
