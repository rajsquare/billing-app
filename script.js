import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  onSnapshot,
  deleteDoc,
  doc,
  serverTimestamp,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ================================
   FIREBASE
================================ */
const firebaseConfig = {
  apiKey: "AIzaSyCthUdAwAP0h67p3MfkanelAPdPzZMmPRo",
  authDomain: "billing-app-73ac8.firebaseapp.com",
  projectId: "billing-app-73ac8",
  storageBucket: "billing-app-73ac8.firebasestorage.app",
  messagingSenderId: "637437936055",
  appId: "1:637437936055:web:f83da0ab2d3e994e96e832"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const billsCollection = collection(db, "bills");
const billsQuery = query(
  billsCollection,
  orderBy("createdAt", "asc")
);

/* ================================
   STATE
================================ */
let products = [];
let billItems = [];
let currentMode = "W";
let currentAction = "print";
let incomingBillCache = {};

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

const printModal = document.getElementById("printModal");
const modalTitle = document.getElementById("modalTitle");
const printDate = document.getElementById("printDate");
const customerName = document.getElementById("customerName");
const customerGroup = document.getElementById("customerGroup");
const serialNumber = document.getElementById("serialNumber");
const cancelPrint = document.getElementById("cancelPrint");
const confirmPrint = document.getElementById("confirmPrint");
const confirmSend = document.getElementById("confirmSend");

const printInvoice = document.getElementById("printInvoice");
const incomingBills = document.getElementById("incomingBills");

/* ================================
   DATE
================================ */
function setTodayDate() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");

  printDate.value = `${yyyy}-${mm}-${dd}`;
}

setTodayDate();

/* ================================
   HELPERS
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

function formatDisplayDate(dateString) {
  const date = new Date(dateString);

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  });
}

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
   SEARCH
================================ */
const synonyms = {
  bucket: ["balti", "baldi"],
  balti: ["bucket"],
  baldi: ["bucket"],
  thal: ["thaal", "thali", "thaali"],
  thaal: ["thal", "thali"],
  thali: ["thal", "thaal"],
  hammer: ["mathar"],
  mathar: ["hammer"],
  kansa: ["bronze"],
  bronze: ["kansa"],
  katora: ["waati", "wati", "vaati", "vati"],
  dabba: ["box"],
  box: ["dabba"],
  ladle: ["kalchul"],
  kalchul: ["ladle"]
};

function expandQuery(query) {
  const words = tokenize(query);
  let expanded = [...words];

  words.forEach(word => {
    if (synonyms[word]) {
      expanded.push(...synonyms[word]);
    }
  });

  return [...new Set(expanded)];
}

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

  if (product.searchableText === rawQuery) score += 500;
  if (product.searchableText.includes(rawQuery)) score += 120;

  queryTokens.forEach(queryToken => {
    let best = 0;

    product.searchableTokens.forEach(productToken => {
      const score = tokenScore(queryToken, productToken);
      if (score > best) best = score;
    });

    score += best;
  });

  return score;
}

function searchProducts(queryText) {
  const clean = normalize(queryText);
  if (!clean) return [];

  const queryTokens = expandQuery(clean);

  return products
    .map(product => ({
      product,
      score: scoreProduct(product, queryTokens, clean)
    }))
    .filter(result => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(result => result.product);
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
   SEARCH UI
================================ */
function renderSuggestions(results) {
  if (!results.length) {
    suggestions.innerHTML = "";
    return;
  }

  let html = "";

  results.forEach(product => {
    html += `
      <div class="suggestion-card" onclick="selectProduct(${product.sr})">
        <div class="suggestion-top">
          <div class="suggestion-name">${product.productName}</div>
          <div class="suggestion-price">₹${getCurrentPrice(product) || "-"}</div>
        </div>

        <div class="badge-row">
          <div class="unit">${product.priceType || ""}</div>
          ${
            product.material
              ? `<div class="unit ${getMaterialClass(product.material)}">${product.material}</div>`
              : ""
          }
        </div>
      </div>
    `;
  });

  suggestions.innerHTML = html;
}

searchBox.addEventListener("input", e => {
  const value = e.target.value;

  clearSearch.style.display = value ? "flex" : "none";

  if (!value.trim()) {
    suggestions.innerHTML = "";
    return;
  }

  renderSuggestions(searchProducts(value));
});

clearSearch.addEventListener("click", () => {
  searchBox.value = "";
  suggestions.innerHTML = "";
  clearSearch.style.display = "none";
  searchBox.focus();
});

/* ================================
   BILL ITEMS
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

function renderBill() {
  if (!billItems.length) {
    billItemsDiv.innerHTML = "";
    return;
  }

  let html = "";

  billItems.forEach((item, index) => {
    html += `
      <div class="bill-card">
        <div class="bill-title">${item.product.productName}</div>

        <div class="badge-row">
          <div class="unit">${item.product.priceType}</div>
          ${
            item.product.material
              ? `<div class="unit ${getMaterialClass(item.product.material)}">${item.product.material}</div>`
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
   MODE
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
function validateBillInputs() {
  if (!serialNumber.value.trim()) {
    alert("Enter serial number");
    return false;
  }

  if (currentMode === "W" && !customerName.value.trim()) {
    alert("Enter customer name");
    return false;
  }

  return true;
}

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

printBtn.addEventListener("click", () => openModal("print"));
sendBtn.addEventListener("click", () => openModal("send"));

cancelPrint.addEventListener("click", () => {
  printModal.style.display = "none";
});

/* ================================
   PRINT HTML
================================ */
function buildPrintHTML(billData) {
  let rows = "";

  billData.items.forEach(item => {
    rows += `
      <tr>
        <td>${item.productName}</td>
        <td>${item.material || "-"}</td>
        <td>${item.qty}</td>
        <td>₹${item.price}</td>
        <td>₹${item.total.toFixed(2)}</td>
      </tr>
    `;
  });

  const customerHeading =
    billData.mode === "W"
      ? `<div class="print-customer">${billData.customerName}</div>`
      : "";

  const wholesaleExtras =
    billData.mode === "W"
      ? `
        <div class="print-balance">Balance HV</div>
        <div class="receiver-name-box">
          <div class="receiver-line"></div>
          <div class="receiver-label">Receiver’s Name</div>
        </div>
      `
      : "";

  return `
    <div class="print-wrapper">
      <div class="print-top">
        <div>${formatDisplayDate(billData.date)}</div>
        <div>${billData.serialNumber}</div>
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
        Grand Total: ₹${billData.grandTotal.toFixed(2)}
      </div>

      ${wholesaleExtras}
    </div>
  `;
}

/* ================================
   LOCAL PRINT
================================ */
confirmPrint.addEventListener("click", () => {
  if (!validateBillInputs()) return;

  const grandTotal = billItems.reduce(
    (sum, item) => sum + item.total,
    0
  );

  const billData = {
    mode: currentMode,
    date: printDate.value,
    customerName: customerName.value.trim(),
    serialNumber: serialNumber.value.trim(),
    grandTotal,
    items: billItems.map(item => ({
      productName: item.product.productName,
      material: item.product.material || "",
      qty: item.qty,
      price: item.price,
      total: item.total
    }))
  };

  printInvoice.innerHTML = buildPrintHTML(billData);
  printModal.style.display = "none";
  window.print();
});

/* ================================
   SEND
================================ */
confirmSend.addEventListener("click", async () => {
  if (!validateBillInputs()) return;

  const grandTotal = billItems.reduce(
    (sum, item) => sum + item.total,
    0
  );

  const billData = {
    mode: currentMode,
    date: printDate.value,
    customerName: customerName.value.trim(),
    serialNumber: serialNumber.value.trim(),
    grandTotal,
    items: billItems.map(item => ({
      productName: item.product.productName,
      material: item.product.material || "",
      qty: item.qty,
      price: item.price,
      total: item.total
    })),
    createdAt: serverTimestamp()
  };

  try {
    await addDoc(billsCollection, billData);

    billItems = [];
    renderBill();
    updateGrandTotal();

    printModal.style.display = "none";

    customerName.value = "";
    serialNumber.value = "";

    alert("Bill sent successfully.");
  } catch (err) {
    alert("Failed to send bill. Check internet.");
    console.error(err);
  }
});

/* ================================
   RECEIVER
================================ */
function renderIncomingBills() {
  const ids = Object.keys(incomingBillCache);

  if (!ids.length) {
    incomingBills.innerHTML = `
      <div class="receiver-subtitle">
        No incoming bills
      </div>
    `;
    return;
  }

  let html = "";

  ids.forEach(id => {
    const bill = incomingBillCache[id];

    html += `
      <div class="bill-card">
        <div class="bill-title">
          ${bill.mode === "W" ? bill.customerName : "Retail Bill"}
        </div>

        <div class="badge-row">
          <div class="unit">${formatDisplayDate(bill.date)}</div>
          <div class="unit">${bill.serialNumber}</div>
        </div>

        <div style="margin-top:12px;font-weight:700;font-size:20px;">
          ₹${bill.grandTotal.toFixed(2)}
        </div>

        <div class="action-buttons" style="margin-top:14px;">
          <button
            class="primary-btn"
            onclick="printReceivedBill('${id}')"
          >
            Print
          </button>

          <button
            class="send-btn"
            onclick="deleteReceivedBill('${id}')"
          >
            Done
          </button>
        </div>
      </div>
    `;
  });

  incomingBills.innerHTML = html;
}

onSnapshot(billsQuery, snapshot => {
  incomingBillCache = {};

  snapshot.forEach(docSnap => {
    incomingBillCache[docSnap.id] = docSnap.data();
  });

  renderIncomingBills();
});

window.printReceivedBill = function(docId) {
  const bill = incomingBillCache[docId];
  if (!bill) return;

  printInvoice.innerHTML = buildPrintHTML(bill);
  window.print();
};

window.deleteReceivedBill = async function(docId) {
  try {
    await deleteDoc(doc(db, "bills", docId));
  } catch (err) {
    alert("Delete failed");
    console.error(err);
  }
};
