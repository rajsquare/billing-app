/* ================================
   GLOBAL STATE
================================ */
let products = [];
let billItems = [];
let currentMode = "W";
let currentAction = "print";

/* ================================
   DOM
================================ */
const billingTab = document.getElementById("billingTab");
const receiverTab = document.getElementById("receiverTab");
const billingView = document.getElementById("billingView");
const receiverView = document.getElementById("receiverView");

const searchBox = document.getElementById("searchBox");
const suggestions = document.getElementById("suggestions");
const billItemsDiv = document.getElementById("billItems");
const grandTotalEl = document.getElementById("grandTotal");
const modeToggle = document.getElementById("modeToggle");
const clearSearch = document.getElementById("clearSearch");

const printBtn = document.getElementById("printBtn");
const sendBtn = document.getElementById("sendBtn");

const printInvoice = document.getElementById("printInvoice");

const printModal = document.getElementById("printModal");
const modalTitle = document.getElementById("modalTitle");
const printDate = document.getElementById("printDate");
const customerName = document.getElementById("customerName");
const customerGroup = document.getElementById("customerGroup");
const serialNumber = document.getElementById("serialNumber");

const cancelPrint = document.getElementById("cancelPrint");
const confirmPrint = document.getElementById("confirmPrint");
const confirmSend = document.getElementById("confirmSend");

/* ================================
   INIT DATE
================================ */
setTodayDate();

function setTodayDate() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");

  printDate.value = `${yyyy}-${mm}-${dd}`;
}

/* ================================
   NORMALIZE
================================ */
function normalize(text) {
  return text
    .toString()
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text) {
  return normalize(text)
    .split(" ")
    .filter(Boolean);
}

/* ================================
   LOAD PRODUCTS
================================ */
fetch("productList.json")
  .then(res => res.json())
  .then(data => {
    products = data.map(product => {
      const searchableText = normalize(
        product.productName + " " + (product.material || "")
      );

      return {
        ...product,
        searchableText,
        searchableTokens: tokenize(searchableText)
      };
    });
  });

/* ================================
   SYNONYMS
================================ */
const synonyms = {
  bucket: ["balti", "baldi"],
  balti: ["bucket"],
  baldi: ["bucket"],

  thal: ["thaal", "thali", "thaali"],
  thaal: ["thal", "thali", "thaali"],
  thali: ["thal", "thaal", "thaali"],
  thaali: ["thal", "thaal", "thali"],

  hammer: ["mathar"],
  mathar: ["hammer"],

  kansa: ["bronze"],
  bronze: ["kansa"],

  katora: ["waati", "wati", "vaati", "vati"],
  waati: ["katora"],
  wati: ["katora"],
  vaati: ["katora"],
  vati: ["katora"],

  dabba: ["box"],
  box: ["dabba"],

  ladle: ["kalchul"],
  kalchul: ["ladle"]
};

function expandQuery(query) {
  const words = tokenize(query);
  let expanded = [...words];

  words.forEach(w => {
    if (synonyms[w]) expanded.push(...synonyms[w]);
  });

  return [...new Set(expanded)];
}

/* ================================
   LEVENSHTEIN
================================ */
function levenshtein(a, b) {
  if (a === b) return 0;

  const matrix = [];

  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

function tokenScore(queryToken, productToken) {
  if (queryToken === productToken) return 100;
  if (productToken.startsWith(queryToken)) return 40;
  if (productToken.includes(queryToken)) return 25;
  if (queryToken.length <= 2) return 0;

  const distance = levenshtein(queryToken, productToken);

  if (distance === 1) return 18;
  if (distance === 2 && queryToken.length >= 5) return 10;

  return 0;
}

function scoreProduct(product, queryTokens, rawQuery) {
  let score = 0;
  const productTokens = product.searchableTokens;

  if (product.searchableText === rawQuery) score += 500;
  if (product.searchableText.includes(rawQuery)) score += 120;

  queryTokens.forEach(queryToken => {
    let best = 0;

    productTokens.forEach(productToken => {
      const s = tokenScore(queryToken, productToken);
      if (s > best) best = s;
    });

    score += best;
  });

  if (
    product.material &&
    queryTokens.includes(normalize(product.material))
  ) {
    score += 35;
  }

  return score;
}

function searchProducts(query) {
  const clean = normalize(query);
  if (!clean) return [];

  const queryTokens = expandQuery(clean);

  return products
    .map(product => ({
      product,
      score: scoreProduct(product, queryTokens, clean)
    }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(r => r.product);
}

/* ================================
   HELPERS
================================ */
function getCurrentPrice(product) {
  return currentMode === "W"
    ? product.wPrice
    : product.rPrice;
}

function getMaterialClass(material) {
  if (material === "Brass") return "material-brass";
  if (material === "Copper") return "material-copper";
  if (material === "Kansa") return "material-kansa";
  return "";
}

function formatDisplayDate(dateString) {
  const date = new Date(dateString);

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  });
}

/* ================================
   TABS
================================ */
billingTab.addEventListener("click", () => {
  billingTab.classList.add("active");
  receiverTab.classList.remove("active");
  billingView.style.display = "block";
  receiverView.style.display = "none";
});

receiverTab.addEventListener("click", () => {
  receiverTab.classList.add("active");
  billingTab.classList.remove("active");
  billingView.style.display = "none";
  receiverView.style.display = "block";
});

/* ================================
   SEARCH
================================ */
function renderSuggestions(results) {
  if (!results.length) {
    suggestions.innerHTML = "";
    return;
  }

  let html = "";

  results.forEach(product => {
    const materialClass = getMaterialClass(product.material);

    html += `
      <div class="suggestion-card" onclick="selectProduct(${product.sr})">
        <div class="suggestion-top">
          <div class="suggestion-name">${product.productName}</div>
          <div class="suggestion-price">₹${getCurrentPrice(product) || "-"}</div>
        </div>

        <div class="badge-row">
          <div class="unit ${product.priceType === "PP" ? "unit-pp" : ""}">
            ${product.priceType || ""}
          </div>

          ${
            product.material
              ? `<div class="unit ${materialClass}">${product.material}</div>`
              : ""
          }
        </div>
      </div>
    `;
  });

  suggestions.innerHTML = html;
}

searchBox.addEventListener("input", e => {
  const val = e.target.value;

  clearSearch.style.display = val ? "flex" : "none";

  if (!val.trim()) {
    suggestions.innerHTML = "";
    return;
  }

  renderSuggestions(searchProducts(val));
});

clearSearch.addEventListener("click", () => {
  searchBox.value = "";
  suggestions.innerHTML = "";
  clearSearch.style.display = "none";
  searchBox.focus();
});

/* ================================
   SELECT PRODUCT
================================ */
window.selectProduct = function(sr) {
  const product = products.find(p => p.sr === sr);
  if (!product) return;

  const existing = billItems.find(
    item =>
      item.product.sr === product.sr &&
      item.mode === currentMode
  );

  if (existing) {
    existing.qty += 1;
    existing.total = existing.qty * existing.price;
  } else {
    billItems.push({
      product,
      mode: currentMode,
      price: getCurrentPrice(product) || 0,
      qty: 1,
      total: getCurrentPrice(product) || 0
    });
  }

  renderBill();
  updateGrandTotal();

  searchBox.value = "";
  suggestions.innerHTML = "";
  clearSearch.style.display = "none";
};

/* ================================
   BILL
================================ */
function renderBill() {
  if (!billItems.length) {
    billItemsDiv.innerHTML = "";
    return;
  }

  let html = "";

  billItems.forEach((item, index) => {
    const materialClass = getMaterialClass(item.product.material);

    html += `
      <div class="bill-card">

        <div class="bill-title">
          ${item.product.productName}
        </div>

        <div class="badge-row">
          <div class="unit">${item.product.priceType || ""}</div>

          ${
            item.product.material
              ? `<div class="unit ${materialClass}">${item.product.material}</div>`
              : ""
          }
        </div>

        <div class="input-row">
          <div class="input-group">
            <div class="input-label">Price</div>
            <input
              class="bill-input"
              type="number"
              value="${item.price}"
              onchange="updatePrice(${index}, this.value)"
            >
          </div>

          <div class="input-group">
            <div class="input-label">Qty</div>
            <input
              class="bill-input"
              type="number"
              step="0.01"
              value="${item.qty}"
              onchange="updateQty(${index}, this.value)"
            >
          </div>
        </div>

        <div class="bill-bottom">
          <div class="line-total">₹${item.total.toFixed(2)}</div>

          <button
            class="delete-btn"
            onclick="deleteItem(${index})"
          >
            Remove
          </button>
        </div>

      </div>
    `;
  });

  billItemsDiv.innerHTML = html;
}

window.updatePrice = function(index, value) {
  billItems[index].price = parseFloat(value) || 0;
  billItems[index].total =
    billItems[index].price * billItems[index].qty;

  renderBill();
  updateGrandTotal();
};

window.updateQty = function(index, value) {
  billItems[index].qty = parseFloat(value) || 0;
  billItems[index].total =
    billItems[index].price * billItems[index].qty;

  renderBill();
  updateGrandTotal();
};

window.deleteItem = function(index) {
  billItems.splice(index, 1);
  renderBill();
  updateGrandTotal();
};

function updateGrandTotal() {
  const total = billItems.reduce(
    (sum, item) => sum + item.total,
    0
  );

  grandTotalEl.innerText = `₹${total.toFixed(2)}`;
}

/* ================================
   MODE TOGGLE
================================ */
modeToggle.addEventListener("click", () => {
  if (currentMode === "W") {
    currentMode = "R";
    modeToggle.innerText = "R";
    modeToggle.style.background = "#d65353";
  } else {
    currentMode = "W";
    modeToggle.innerText = "W";
    modeToggle.style.background = "#2f3f64";
  }

  if (searchBox.value.trim()) {
    renderSuggestions(searchProducts(searchBox.value));
  }
});

/* ================================
   MODAL
================================ */
function openModal(action) {
  if (!billItems.length) return;

  currentAction = action;
  setTodayDate();

  customerGroup.style.display =
    currentMode === "W" ? "block" : "none";

  if (currentMode === "R") {
    customerName.value = "";
  }

  modalTitle.innerText =
    action === "print"
      ? "Print Details"
      : "Send Details";

  printModal.style.display = "flex";
}

printBtn.addEventListener("click", () => {
  openModal("print");
});

sendBtn.addEventListener("click", () => {
  openModal("send");
});

cancelPrint.addEventListener("click", () => {
  printModal.style.display = "none";
});

/* ================================
   PRINT
================================ */
confirmPrint.addEventListener("click", () => {
  if (currentMode === "W" && !customerName.value.trim()) {
    alert("Please enter customer name");
    return;
  }

  generatePrint();
});

function generatePrint() {
  const displayDate =
    formatDisplayDate(printDate.value);

  let rows = "";
  let grandTotal = 0;

  billItems.forEach(item => {
    grandTotal += item.total;

    rows += `
      <tr>
        <td>${item.product.productName}</td>
        <td>${item.product.material || "-"}</td>
        <td>${item.qty}</td>
        <td>₹${item.price}</td>
        <td>₹${item.total.toFixed(2)}</td>
      </tr>
    `;
  });

  const customerHeading =
    currentMode === "W"
      ? `<div class="print-customer">${customerName.value.trim()}</div>`
      : "";

  const wholesaleExtras =
    currentMode === "W"
      ? `
        <div class="print-balance">Balance HV</div>

        <div class="receiver-name-box">
          <div class="receiver-line"></div>
          <div class="receiver-label">Receiver’s Name</div>
        </div>
      `
      : "";

  printInvoice.innerHTML = `
    <div class="print-wrapper">

      <div class="print-top">
        <div>${displayDate}</div>
        <div>${serialNumber.value.trim()}</div>
      </div>

      ${customerHeading}

      <table class="print-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Material</th>
            <th>Qty</th>
            <th>Rate</th>
            <th>Total</th>
          </tr>
        </thead>

        <tbody>
          ${rows}
        </tbody>
      </table>

      <div class="print-total">
        Grand Total: ₹${grandTotal.toFixed(2)}
      </div>

      ${wholesaleExtras}

    </div>
  `;

  printModal.style.display = "none";
  window.print();
}

/* ================================
   SEND PLACEHOLDER
================================ */
confirmSend.addEventListener("click", () => {
  if (currentMode === "W" && !customerName.value.trim()) {
    alert("Please enter customer name");
    return;
  }

  alert("Firebase send integration coming next.");
});
