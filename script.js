import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
 getFirestore,
  collection,
  addDoc,
  onSnapshot,
  doc,
  serverTimestamp,
  query,
  orderBy,
  runTransaction
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

const serialDocRef = doc(db, "serialCounters", "serials");

/* ================================
   CONSTANTS
================================ */
const ADMIN_PASSWORD = "1110";

/* ================================
   STATE
================================ */
let products = [];
let billItems = [];
let currentMode = "W";
let incomingBillCache = {};

let isReceiverBusy = false;
let isSendingBill = false;

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

const sendBtn = document.getElementById("sendBtn");

const printModal = document.getElementById("printModal");
const modalTitle = document.getElementById("modalTitle");
const printDate = document.getElementById("printDate");
const customerName = document.getElementById("customerName");
const customerGroup = document.getElementById("customerGroup");
const cancelPrint = document.getElementById("cancelPrint");
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

function requireAdminPassword() {
  const entered = prompt("Enter admin password");

  if (entered === null) {
    return false;
  }

  if (entered !== ADMIN_PASSWORD) {
    alert("Incorrect password.");
    return false;
  }

  return true;
}

/* ================================
   PRODUCTS
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
  bronze: ["kansa"]
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

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

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
      const s = tokenScore(queryToken, productToken);
      if (s > best) best = s;
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
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(r => r.product);
}
/* ================================
   UI
================================ */
billingTab.addEventListener("click", () => {
  billingView.style.display = "block";
  receiverView.style.display = "none";
  billingTab.classList.add("active");
  receiverTab.classList.remove("active");
});

receiverTab.addEventListener("click", () => {
  billingView.style.display = "none";
  receiverView.style.display = "block";
  receiverTab.classList.add("active");
  billingTab.classList.remove("active");
});

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
   BILL UI
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
    const price = getCurrentPrice(product) || 0;

    billItems.push({
      product,
      mode: currentMode,
      price,
      qty: 1,
      total: price
    });
  }

  renderBill();
  updateGrandTotal();

  searchBox.value = "";
  suggestions.innerHTML = "";
  clearSearch.style.display = "none";
};

function renderBill() {
  let html = "";

  billItems.forEach((item, index) => {
    html += `
      <div class="bill-card">
        <div class="bill-title">${item.product.productName}</div>

        <div class="badge-row">
          <div class="unit">${item.product.priceType || ""}</div>
          ${
            item.product.material
              ? `<div class="unit ${getMaterialClass(item.product.material)}">${item.product.material}</div>`
              : ""
          }
        </div>

   <div class="input-row">
  <input
    class="bill-input"
    type="text"
    inputmode="decimal"
    value="${item.price}"
    onchange="updatePrice(${index}, this.value)"
  >

  <input
    class="bill-input"
    type="text"
    inputmode="decimal"
    value="${item.qty}"
    onchange="updateQty(${index}, this.value)"
  >
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

  grandTotalEl.innerText = `₹${Math.round(total)}`;
}

/* ================================
   MODAL
================================ */
function validateBillInputs() {
  if (!billItems.length) {
    alert("Add at least one item.");
    return false;
  }

  if (currentMode === "W" && !customerName.value.trim()) {
    alert("Enter customer name.");
    return false;
  }

  return true;
}

function openSendModal() {
  if (!billItems.length) return;

  setTodayDate();

  customerGroup.style.display =
    currentMode === "W" ? "block" : "none";

  modalTitle.innerText = "Send Details";

  printModal.style.display = "flex";
}

sendBtn.addEventListener("click", openSendModal);

cancelPrint.addEventListener("click", () => {
  printModal.style.display = "none";
});

/* ================================
   BILL DATA
================================ */
function createBillData() {
  const grandTotal = billItems.reduce(
    (sum, item) => sum + item.total,
    0
  );

 return {
  mode: currentMode,
  date: printDate.value,
  customerName: customerName.value.trim(),
  grandTotal: Math.round(grandTotal),
    status: "pending",
    serialNumber: null,
    items: billItems.map(item => ({
      productName: item.product.productName,
      material: item.product.material || "",
      qty: item.qty,
      price: item.price,
      total: item.total
    }))
  };
}

/* ================================
   SEND
================================ */
confirmSend.addEventListener("click", async () => {
  if (isSendingBill) return;
  if (!validateBillInputs()) return;

  isSendingBill = true;

  try {
    const billData = createBillData();
    billData.createdAt = serverTimestamp();

    await addDoc(billsCollection, billData);

    billItems = [];
    renderBill();
    updateGrandTotal();

    customerName.value = "";
    printModal.style.display = "none";

    alert("Bill sent successfully.");
  } catch (err) {
    console.error(err);
    alert("Failed to send bill: " + err.message);
  } finally {
    isSendingBill = false;
  }
});
/* ================================
   SERIAL HELPERS
================================ */
function getModeKeys(mode) {
  return {
    counterKey: mode,
    reusableKey: mode + "Reusable",
    activeKey: mode + "Active"
  };
}

function getLowestAvailableSerial(counter, reusable, active) {
  const reusableSorted = [...reusable].sort((a, b) => a - b);

  if (reusableSorted.length > 0) {
    return {
      serial: reusableSorted[0],
      source: "reusable"
    };
  }

  for (let i = 1; i <= 100; i++) {
    const candidate = ((counter + i - 1) % 100) + 1;

    if (!active.includes(candidate)) {
      return {
        serial: candidate,
        source: "new"
      };
    }
  }

  return null;
}

/* ================================
   PRINT ENGINE
================================ */
function buildSingleCopy(billData, label) {
  let rows = "";

  billData.items.forEach(item => {
    rows += `
      <tr>
        <td>${item.productName}</td>
        <td>${item.material || "-"}</td>
        <td>${item.qty}</td>
        <td>${item.price}</td>
        <td>${item.total.toFixed(2)}</td>
      </tr>
    `;
  });

  const title =
    billData.mode === "W"
      ? billData.customerName
      : "RETAIL BILL";

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
      <div class="copy-label">${label}</div>

      <div class="print-header-row">
        <div class="print-customer">${title}</div>
        <div class="print-serial">#${billData.serialNumber}</div>
      </div>

      <div class="print-date">${formatDisplayDate(billData.date)}</div>

      <table class="print-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Mat</th>
            <th>Qty</th>
            <th>Rate</th>
            <th>Amt</th>
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

function buildPrintHTML(billData) {
  return `
    ${buildSingleCopy(billData, "CUSTOMER COPY")}
    ${buildSingleCopy(billData, "OFFICE COPY")}
  `;
}

function printBillData(billData) {
  printInvoice.innerHTML = buildPrintHTML(billData);
  window.print();
}

/* ================================
   RECEIVER UI
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

    let buttons = "";

    if (bill.status === "pending") {
      buttons = `
        <button
          class="primary-btn"
          onclick="printReceivedBill('${id}')"
        >
          Print
        </button>

        <button
          class="delete-btn"
          onclick="deleteReceivedBill('${id}')"
        >
          Delete
        </button>
      `;
    } else {
      buttons = `
        <button
          class="primary-btn"
          onclick="reprintReceivedBill('${id}')"
        >
          Reprint
        </button>

        <button
          class="send-btn"
          onclick="doneReceivedBill('${id}')"
        >
          Done
        </button>

        <button
          class="delete-btn"
          onclick="deleteReceivedBill('${id}')"
        >
          Delete
        </button>
      `;
    }

    html += `
      <div class="bill-card">
        <div class="bill-title">
          ${
            bill.mode === "W"
              ? bill.customerName
              : "Retail Bill"
          }
        </div>

        <div class="badge-row">
          <div class="unit">
            ${formatDisplayDate(bill.date)}
          </div>

          <div class="unit">
            ${bill.mode}
          </div>

          ${
            bill.serialNumber
              ? `<div class="unit">#${bill.serialNumber}</div>`
              : ""
          }
        </div>

        <div style="margin-top:12px;font-weight:700;font-size:20px;">
          ₹${bill.grandTotal.toFixed(2)}
        </div>

        <div class="action-buttons" style="margin-top:14px;">
          ${buttons}
        </div>
      </div>
    `;
  });

  incomingBills.innerHTML = html;
}

/* ================================
   FIREBASE LISTENER
================================ */
onSnapshot(billsQuery, snapshot => {
  incomingBillCache = {};

  snapshot.forEach(docSnap => {
    incomingBillCache[docSnap.id] = docSnap.data();
  });

  renderIncomingBills();
});

/* ================================
   RECEIVER ACTIONS
================================ */
window.printReceivedBill = async function(docId) {
  if (isReceiverBusy) return;
  isReceiverBusy = true;

  try {
    const billRef = doc(db, "bills", docId);

    const finalBill = await runTransaction(db, async transaction => {
      const billSnap = await transaction.get(billRef);

      if (!billSnap.exists()) {
        throw new Error("Bill not found.");
      }

      const bill = billSnap.data();

      if (bill.status !== "pending") {
        throw new Error("Bill already processed.");
      }

      const serialSnap = await transaction.get(serialDocRef);

      if (!serialSnap.exists()) {
        throw new Error("Serial document missing.");
      }

    const serialData = serialSnap.data();
const keys = getModeKeys(bill.mode);

const counter = serialData[keys.counterKey] || 0;

const active = [
  ...new Set(serialData[keys.activeKey] || [])
];

let reusable = [
  ...new Set(serialData[keys.reusableKey] || [])
];

reusable = reusable.filter(
  s => !active.includes(s)
);
      const allocation = getLowestAvailableSerial(
        counter,
        reusable,
        active
      );

      if (!allocation) {
        throw new Error("No serials available.");
      }

      let nextReusable = [...reusable];
      let nextActive = [...active, allocation.serial];
      let updates = {
        [keys.activeKey]: nextActive
      };

      if (allocation.source === "reusable") {
        nextReusable = reusable.filter(
          s => s !== allocation.serial
        );

        updates[keys.reusableKey] = nextReusable;
      } else {
        updates[keys.counterKey] = allocation.serial;
      }

      transaction.update(serialDocRef, updates);

      transaction.update(billRef, {
        status: "printed",
        serialNumber: allocation.serial
      });

      return {
        ...bill,
        status: "printed",
        serialNumber: allocation.serial
      };
    });

    printBillData(finalBill);
  } catch (err) {
    console.error(err);
    alert("Failed to print: " + err.message);
  } finally {
    isReceiverBusy = false;
  }
};

window.reprintReceivedBill = async function(docId) {
  if (isReceiverBusy) return;
  isReceiverBusy = true;

  try {
    const bill = incomingBillCache[docId];

    if (!bill) {
      throw new Error("Bill not found.");
    }

    if (bill.status !== "printed") {
      throw new Error("Bill not printed yet.");
    }

    printBillData(bill);
  } catch (err) {
    console.error(err);
    alert("Failed to reprint: " + err.message);
  } finally {
    isReceiverBusy = false;
  }
};

window.doneReceivedBill = async function(docId) {
  if (isReceiverBusy) return;
  if (!requireAdminPassword()) return;

  isReceiverBusy = true;

  try {
    const billRef = doc(db, "bills", docId);

    await runTransaction(db, async transaction => {
      const billSnap = await transaction.get(billRef);

      if (!billSnap.exists()) {
        throw new Error("Bill not found.");
      }

      const bill = billSnap.data();

      if (bill.status !== "printed" || !bill.serialNumber) {
        throw new Error("Bill not eligible for completion.");
      }

      const serialSnap = await transaction.get(serialDocRef);

      if (!serialSnap.exists()) {
        throw new Error("Serial document missing.");
      }

      const serialData = serialSnap.data();
      const keys = getModeKeys(bill.mode);

     let active = [
  ...new Set(serialData[keys.activeKey] || [])
];
      active = active.filter(
        s => s !== bill.serialNumber
      );

      transaction.update(serialDocRef, {
        [keys.activeKey]: active
      });

      transaction.delete(billRef);
    });
  } catch (err) {
    console.error(err);
    alert("Failed to complete bill: " + err.message);
  } finally {
    isReceiverBusy = false;
  }
};

window.deleteReceivedBill = async function(docId) {
  if (isReceiverBusy) return;
  if (!requireAdminPassword()) return;

  isReceiverBusy = true;

  try {
    const billRef = doc(db, "bills", docId);

    await runTransaction(db, async transaction => {
      const billSnap = await transaction.get(billRef);

      if (!billSnap.exists()) {
        throw new Error("Bill not found.");
      }

      const bill = billSnap.data();

      if (bill.status === "pending") {
        transaction.delete(billRef);
        return;
      }

      if (!bill.serialNumber) {
        throw new Error("Invalid printed bill.");
      }

      const serialSnap = await transaction.get(serialDocRef);

      if (!serialSnap.exists()) {
        throw new Error("Serial document missing.");
      }

      const serialData = serialSnap.data();
      const keys = getModeKeys(bill.mode);

     let active = [
  ...new Set(serialData[keys.activeKey] || [])
];

let reusable = [
  ...new Set(serialData[keys.reusableKey] || [])
];

reusable = reusable.filter(
  s => !active.includes(s)
);

      active = active.filter(
        s => s !== bill.serialNumber
      );

      if (!reusable.includes(bill.serialNumber)) {
        reusable.push(bill.serialNumber);
        reusable.sort((a, b) => a - b);
      }

      transaction.update(serialDocRef, {
        [keys.activeKey]: active,
        [keys.reusableKey]: reusable
      });

      transaction.delete(billRef);
    });
  } catch (err) {
    console.error(err);
    alert("Failed to delete bill: " + err.message);
  } finally {
    isReceiverBusy = false;
  }
};
