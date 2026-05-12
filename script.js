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
  runTransaction,
  getDocs,
  writeBatch
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
const daybookCollection = collection(db, "daybook");

const billsQuery = query(
  billsCollection,
  orderBy("createdAt", "asc")
);

const daybookQuery = query(
  daybookCollection,
  orderBy("createdAt", "asc")
);

const serialDocRef = doc(
  db,
  "serialCounters",
  "serials"
);

/* ================================
   CONSTANTS
================================ */
const ADMIN_PASSWORD = "1110";
const BILL_DRAFT_KEY = "billingAppDraftV4";
const DRAFT_MAX_AGE_MS =
  24 * 60 * 60 * 1000;

/* ================================
   STATE
================================ */
let products = [];
let billItems = [];
let currentMode = "W";

let incomingBillCache = {};
let daybookCache = {};

let isReceiverBusy = false;
let isSendingBill = false;
let isDaybookBusy = false;
let daybookPrintedOnce = false;

/* ================================
   DOM
================================ */
const billingTab =
  document.getElementById("billingTab");
const receiverTab =
  document.getElementById("receiverTab");
const daybookTab =
  document.getElementById("daybookTab");

const billingView =
  document.getElementById("billingView");
const receiverView =
  document.getElementById("receiverView");
const daybookView =
  document.getElementById("daybookView");

const searchBox =
  document.getElementById("searchBox");
const suggestions =
  document.getElementById("suggestions");
const billItemsDiv =
  document.getElementById("billItems");
const grandTotalEl =
  document.getElementById("grandTotal");
const modeToggle =
  document.getElementById("modeToggle");
const clearSearch =
  document.getElementById("clearSearch");

const sendBtn =
  document.getElementById("sendBtn");

const printModal =
  document.getElementById("printModal");
const customerName =
  document.getElementById("customerName");
const customerGroup =
  document.getElementById("customerGroup");
const cancelPrint =
  document.getElementById("cancelPrint");
const confirmSend =
  document.getElementById("confirmSend");

const printInvoice =
  document.getElementById("printInvoice");
const incomingBills =
  document.getElementById("incomingBills");

const previewModal =
  document.getElementById("previewModal");
const previewContent =
  document.getElementById("previewContent");
const closePreview =
  document.getElementById("closePreview");

const daybookSummary =
  document.getElementById("daybookSummary");
const daybookActions =
  document.getElementById("daybookActions");
const daybookEntries =
  document.getElementById("daybookEntries");

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

function escapeAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function requireAdminPassword() {
  const entered =
    prompt("Enter admin password");

  if (entered === null) {
    return false;
  }

  if (entered !== ADMIN_PASSWORD) {
    alert("Incorrect password.");
    return false;
  }

  return true;
}

function getIndiaDateInfo() {
  const now = new Date();

  const formatter =
    new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric"
    });

  return {
    displayDate:
      formatter.format(now)
  };
}

function getCurrentPrice(product) {
  return currentMode === "W"
    ? product.wPrice
    : product.rPrice;
}

function getMaterialClass(material) {
  if (material === "Brass") {
    return "material-brass";
  }

  if (material === "Copper") {
    return "material-copper";
  }

  if (material === "Kansa") {
    return "material-kansa";
  }

  return "";
}

function shortMaterialName(material) {
  if (material === "Brass") {
    return "BR";
  }

  if (material === "Copper") {
    return "CU";
  }

  if (material === "Kansa") {
    return "BZ";
  }

  return material || "-";
}

function formatIndianMoney(value) {
  return Number(value || 0)
    .toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
}

function clearDraft() {
  localStorage.removeItem(
    BILL_DRAFT_KEY
  );
}

function saveDraft() {
  try {
    if (!billItems.length) {
      clearDraft();
      return;
    }

    const draft = {
      savedAt: Date.now(),
      currentMode,
      customerName:
        customerName.value.trim(),

      billItems:
        billItems.map(item => ({
          productSr:
            item.product.sr,
          mode:
            item.mode,
          price:
            item.price,
          qty:
            item.qty
        }))
    };

    localStorage.setItem(
      BILL_DRAFT_KEY,
      JSON.stringify(draft)
    );
  } catch (err) {
    console.error(
      "Draft save failed:",
      err
    );
  }
}

function restoreDraft() {
  try {
    const raw =
      localStorage.getItem(
        BILL_DRAFT_KEY
      );

    if (!raw) {
      return;
    }

    const draft =
      JSON.parse(raw);

    if (
      !draft ||
      !Array.isArray(
        draft.billItems
      ) ||
      !draft.billItems.length
    ) {
      clearDraft();
      return;
    }

    const age =
      Date.now() -
      (draft.savedAt || 0);

    if (
      age >
      DRAFT_MAX_AGE_MS
    ) {
      clearDraft();
      return;
    }

    const shouldRestore =
      confirm(
        "Resume unfinished bill?"
      );

    if (!shouldRestore) {
      clearDraft();
      return;
    }

    const restoredItems =
      draft.billItems
        .map(savedItem => {
          const product =
            products.find(
              p =>
                p.sr ===
                savedItem.productSr
            );

          if (!product) {
            return null;
          }

          const qty =
            savedItem.qty || "";

          const price =
            parseFloat(
              savedItem.price
            ) || 0;

          const qtyNum =
            parseFloat(qty) || 0;

          return {
            product,
            mode:
              savedItem.mode ||
              "W",
            price,
            qty,
            total:
              price * qtyNum
          };
        })
        .filter(Boolean);

    if (
      !restoredItems.length
    ) {
      clearDraft();
      return;
    }

    currentMode =
      draft.currentMode || "W";

    modeToggle.innerText =
      currentMode;

    modeToggle.style.background =
      currentMode === "W"
        ? "#2f3f64"
        : "#d65353";

    customerName.value =
      draft.customerName || "";

    billItems =
      restoredItems;
        renderBill();
    updateGrandTotal();
  } catch (err) {
    console.error(
      "Draft restore failed:",
      err
    );

    clearDraft();
  }
}

function focusQtyInput(
  index = 0
) {
  requestAnimationFrame(() => {
    const input =
      document.querySelector(
        `[data-qty-index="${index}"]`
      );

    if (!input) {
      return;
    }

    input.focus();
    input.select();
  });
}

/* ================================
   PRODUCTS
================================ */
fetch("productList.json")
  .then(res => res.json())
  .then(data => {
    products = data.map(
      product => {
        const searchableText =
          normalize(
            `${product.productName} ${product.material || ""}`
          );

        return {
          ...product,
          searchableText,
          searchableTokens:
            tokenize(
              searchableText
            )
        };
      }
    );

    restoreDraft();
  })
  .catch(err => {
    console.error(err);
    alert(
      "Failed to load products."
    );
  });

/* ================================
   SEARCH
================================ */
const synonyms = {
  bucket: [
    "balti",
    "baldi"
  ],
  balti: ["bucket"],
  baldi: ["bucket"],
  thal: [
    "thaal",
    "thali",
    "thaali"
  ],
  thaal: [
    "thal",
    "thali"
  ],
  thali: [
    "thal",
    "thaal"
  ],
  hammer: [
    "mathar"
  ],
  mathar: [
    "hammer"
  ],
  kansa: [
    "bronze"
  ],
  bronze: [
    "kansa"
  ]
};

function expandQuery(
  query
) {
  const words =
    tokenize(query);

  let expanded =
    [...words];

  words.forEach(
    word => {
      if (
        synonyms[word]
      ) {
        expanded.push(
          ...synonyms[word]
        );
      }
    }
  );

  return [
    ...new Set(
      expanded
    )
  ];
}

function levenshtein(
  a,
  b
) {
  if (a === b) {
    return 0;
  }

  const matrix = [];

  for (
    let i = 0;
    i <= b.length;
    i++
  ) {
    matrix[i] = [i];
  }

  for (
    let j = 0;
    j <= a.length;
    j++
  ) {
    matrix[0][j] = j;
  }

  for (
    let i = 1;
    i <= b.length;
    i++
  ) {
    for (
      let j = 1;
      j <= a.length;
      j++
    ) {
      if (
        b[i - 1] ===
        a[j - 1]
      ) {
        matrix[i][j] =
          matrix[
            i - 1
          ][j - 1];
      } else {
        matrix[i][j] =
          Math.min(
            matrix[
              i - 1
            ][
              j - 1
            ] + 1,
            matrix[i][
              j - 1
            ] + 1,
            matrix[
              i - 1
            ][j] + 1
          );
      }
    }
  }

  return matrix[
    b.length
  ][a.length];
}

function tokenScore(
  queryToken,
  productToken
) {
  if (
    queryToken ===
    productToken
  ) {
    return 100;
  }

  if (
    productToken.startsWith(
      queryToken
    )
  ) {
    return 40;
  }

  if (
    productToken.includes(
      queryToken
    )
  ) {
    return 25;
  }

  const distance =
    levenshtein(
      queryToken,
      productToken
    );

  if (
    distance === 1
  ) {
    return 18;
  }

  if (
    distance === 2 &&
    queryToken.length >=
      5
  ) {
    return 10;
  }

  return 0;
}

function scoreProduct(
  product,
  queryTokens,
  rawQuery
) {
  let score = 0;

  if (
    product.searchableText ===
    rawQuery
  ) {
    score += 500;
  }

  if (
    product.searchableText.includes(
      rawQuery
    )
  ) {
    score += 120;
  }

  queryTokens.forEach(
    queryToken => {
      let best = 0;

      product.searchableTokens.forEach(
        productToken => {
          const s =
            tokenScore(
              queryToken,
              productToken
            );

          if (
            s > best
          ) {
            best = s;
          }
        }
      );

      score += best;
    }
  );

  return score;
}

function searchProducts(
  queryText
) {
  const clean =
    normalize(
      queryText
    );

  if (!clean) {
    return [];
  }

  const queryTokens =
    expandQuery(
      clean
    );

  return products
    .map(product => ({
      product,
      score:
        scoreProduct(
          product,
          queryTokens,
          clean
        )
    }))
    .filter(
      result =>
        result.score >
        0
    )
    .sort(
      (a, b) =>
        b.score -
        a.score
    )
    .slice(0, 8)
    .map(
      result =>
        result.product
    );
}

/* ================================
   NAVIGATION
================================ */
function activateView(
  view
) {
  billingView.style.display =
    "none";
  receiverView.style.display =
    "none";
  daybookView.style.display =
    "none";

  billingTab.classList.remove(
    "active"
  );
  receiverTab.classList.remove(
    "active"
  );
  daybookTab.classList.remove(
    "active"
  );

  if (
    view ===
    "billing"
  ) {
    billingView.style.display =
      "block";

    billingTab.classList.add(
      "active"
    );
  }

  if (
    view ===
    "receiver"
  ) {
    receiverView.style.display =
      "block";

    receiverTab.classList.add(
      "active"
    );
  }

  if (
    view ===
    "daybook"
  ) {
    daybookView.style.display =
      "block";

    daybookTab.classList.add(
      "active"
    );
  }
}

billingTab.addEventListener(
  "click",
  () =>
    activateView(
      "billing"
    )
);

receiverTab.addEventListener(
  "click",
  () =>
    activateView(
      "receiver"
    )
);

daybookTab.addEventListener(
  "click",
  () =>
    activateView(
      "daybook"
    )
);
/* ================================
   MODE + SEARCH UI
================================ */
modeToggle.addEventListener(
  "click",
  () => {
    if (
      currentMode === "W"
    ) {
      currentMode = "R";
      modeToggle.innerText =
        "R";
      modeToggle.style.background =
        "#d65353";
    } else {
      currentMode = "W";
      modeToggle.innerText =
        "W";
      modeToggle.style.background =
        "#2f3f64";
    }

    if (
      searchBox.value.trim()
    ) {
      renderSuggestions(
        searchProducts(
          searchBox.value
        )
      );
    }

    saveDraft();
  }
);

customerName.addEventListener(
  "input",
  () => {
    saveDraft();
  }
);

searchBox.addEventListener(
  "input",
  e => {
    const value =
      e.target.value;

    clearSearch.style.display =
      value
        ? "flex"
        : "none";

    if (
      !value.trim()
    ) {
      suggestions.innerHTML =
        "";
      return;
    }

    renderSuggestions(
      searchProducts(
        value
      )
    );
  }
);

clearSearch.addEventListener(
  "click",
  () => {
    searchBox.value = "";
    suggestions.innerHTML =
      "";
    clearSearch.style.display =
      "none";
    searchBox.focus();
  }
);

function renderSuggestions(
  results
) {
  if (
    !results.length
  ) {
    suggestions.innerHTML =
      "";
    return;
  }

  let html = "";

  results.forEach(
    product => {
      html += `
        <div
          class="suggestion-card"
          onclick="selectProduct(${product.sr})"
        >
          <div class="suggestion-top">
            <div class="suggestion-name">
              ${product.productName}
            </div>

            <div class="suggestion-price">
              ₹${getCurrentPrice(product) || "-"}
            </div>
          </div>

          <div class="badge-row">
            <div class="unit">
              ${product.priceType || ""}
            </div>

            ${
              product.material
                ? `
                  <div class="unit ${getMaterialClass(product.material)}">
                    ${product.material}
                  </div>
                `
                : ""
            }
          </div>
        </div>
      `;
    }
  );

  suggestions.innerHTML =
    html;
}

/* ================================
   BILLING
================================ */
window.selectProduct =
  function(sr) {
    const product =
      products.find(
        p =>
          p.sr === sr
      );

    if (!product) {
      return;
    }

    const existingIndex =
      billItems.findIndex(
        item =>
          item.product.sr ===
            product.sr &&
          item.mode ===
            currentMode
      );

    if (
      existingIndex !== -1
    ) {
      const existingItem =
        billItems.splice(
          existingIndex,
          1
        )[0];

      billItems.unshift(
        existingItem
      );
    } else {
      billItems.unshift({
        product,
        mode:
          currentMode,
        price:
          getCurrentPrice(
            product
          ) || 0,
        qty: "",
        total: 0
      });
    }

    renderBill();
    updateGrandTotal();
    saveDraft();

    searchBox.value = "";
    suggestions.innerHTML =
      "";
    clearSearch.style.display =
      "none";

    focusQtyInput(0);
  };

function renderBill() {
  let html = "";

  billItems.forEach(
    (
      item,
      index
    ) => {
      const safeQty =
        escapeAttr(
          item.qty
        );

      const safePrice =
        escapeAttr(
          item.price
        );

      html += `
        <div class="bill-card">
          <div class="bill-title">
            ${item.product.productName}
          </div>

          <div class="badge-row">
            <div class="unit">
              ${item.product.priceType || ""}
            </div>

            ${
              item.product.material
                ? `
                  <div class="unit ${getMaterialClass(item.product.material)}">
                    ${item.product.material}
                  </div>
                `
                : ""
            }
          </div>

          <div class="input-row">

            <input
              class="bill-input"
              type="text"
              inputmode="decimal"
              value="${safeQty}"
              data-qty-index="${index}"
              oninput="updateQty(${index}, this.value)"
            >

            <input
              class="bill-input"
              type="text"
              inputmode="decimal"
              value="${safePrice}"
              oninput="updatePrice(${index}, this.value)"
            >

          </div>

          <div class="bill-bottom">
            <div class="line-total">
              ₹${item.total.toFixed(2)}
            </div>

            <button
              class="delete-btn"
              onclick="deleteItem(${index})"
            >
              Remove
            </button>
          </div>
        </div>
      `;
    }
  );

  billItemsDiv.innerHTML =
    html;
}

window.updateQty =
  function(
    index,
    value
  ) {
    if (
      !billItems[index]
    ) {
      return;
    }

    const parsedQty =
      parseFloat(value);

    if (isNaN(parsedQty)) {
      billItems[index].qty = "";
      billItems[index].total = 0;
    } else {
      const roundedQty =
        Math.round(parsedQty * 100) / 100;

      billItems[index].qty =
        roundedQty;

      billItems[index].total =
        billItems[index]
          .price * roundedQty;
    }

    updateGrandTotal();
    saveDraft();

    const qtyInput =
      document.querySelector(
        `[data-qty-index="${index}"]`
      );

    if (qtyInput) {
      qtyInput.value =
        billItems[index].qty || "";
    }

    const totalEl =
      billItemsDiv.querySelectorAll(
        ".line-total"
      )[index];

    if (totalEl) {
      totalEl.innerText =
        `₹${billItems[
          index
        ].total.toFixed(
          2
        )}`;
    }
  };

window.updatePrice =
  function(
    index,
    value
  ) {
    if (
      !billItems[index]
    ) {
      return;
    }

    const parsedPrice =
      parseFloat(
        value
      );

    billItems[index].price =
      isNaN(
        parsedPrice
      )
        ? 0
        : parsedPrice;

    const qty =
      parseFloat(
        billItems[
          index
        ].qty
      ) || 0;

    billItems[index].total =
      billItems[index]
        .price * qty;

    updateGrandTotal();
    saveDraft();

    const totalEl =
      billItemsDiv.querySelectorAll(
        ".line-total"
      )[index];

    if (totalEl) {
      totalEl.innerText =
        `₹${billItems[
          index
        ].total.toFixed(
          2
        )}`;
    }
  };

window.deleteItem =
  function(index) {
    billItems.splice(
      index,
      1
    );

    renderBill();
    updateGrandTotal();
    saveDraft();
  };

function updateGrandTotal() {
  const total =
    billItems.reduce(
      (
        sum,
        item
      ) =>
        sum +
        item.total,
      0
    );

  grandTotalEl.innerText =
    `₹${Math.round(
      total
    )}`;
}

/* ================================
   SEND FLOW
================================ */
function validateBillInputs() {
  if (
    !billItems.length
  ) {
    alert(
      "Add at least one item."
    );
    return false;
  }

  const invalidQty =
    billItems.some(
      item => {
        const qty =
          parseFloat(
            item.qty
          );

        return (
          isNaN(qty) ||
          qty <= 0
        );
      }
    );

  if (
    invalidQty
  ) {
    alert(
      "All items must have quantity greater than zero."
    );
    return false;
  }

  const invalidPrice =
    billItems.some(
      item => {
        const price =
          parseFloat(
            item.price
          );

        return (
          isNaN(
            price
          ) ||
          price <= 0
        );
      }
    );

  if (
    invalidPrice
  ) {
    alert(
      "All items must have valid price greater than zero."
    );
    return false;
  }

  if (
    currentMode ===
      "W" &&
    !customerName.value.trim()
  ) {
    alert(
      "Enter customer name."
    );
    return false;
  }

  return true;
}
function openSendModal() {
  if (!billItems.length) {
    return;
  }

  customerGroup.style.display =
    currentMode === "W"
      ? "block"
      : "none";

  printModal.style.display =
    "flex";
}

sendBtn.addEventListener(
  "click",
  openSendModal
);

cancelPrint.addEventListener(
  "click",
  () => {
    printModal.style.display =
      "none";
  }
);

closePreview.addEventListener(
  "click",
  () => {
    previewModal.style.display =
      "none";

    previewContent.innerHTML =
      "";
  }
);

function createBillData() {
  const grandTotal =
    billItems.reduce(
      (
        sum,
        item
      ) =>
        sum +
        item.total,
      0
    );

  const indiaDate =
    getIndiaDateInfo();

  return {
    mode:
      currentMode,

    date:
      indiaDate.displayDate,

    customerName:
      currentMode === "W"
        ? customerName.value.trim()
        : "Retail Bill",

    grandTotal:
      Math.round(
        grandTotal
      ),

    status:
      "pending",

    serialNumber:
      null,

    items:
      billItems.map(
        item => ({
          productName:
            item.product
              .productName,

          material:
            item.product
              .material || "",

          qty:
            parseFloat(
              item.qty
            ),

          price:
            item.price,

          total:
            item.total
        })
      )
  };
}

confirmSend.addEventListener(
  "click",
  async () => {
    if (
      isSendingBill
    ) {
      return;
    }

    if (
      !validateBillInputs()
    ) {
      return;
    }

    isSendingBill =
      true;

    try {
      const billData =
        createBillData();

      billData.createdAt =
        serverTimestamp();

      await addDoc(
        billsCollection,
        billData
      );

      billItems = [];
      customerName.value =
        "";

      renderBill();
      updateGrandTotal();
      clearDraft();

      printModal.style.display =
        "none";

      alert(
        "Bill sent successfully."
      );
    } catch (err) {
      console.error(err);

      alert(
        "Failed to send bill: " +
          err.message
      );
    } finally {
      isSendingBill =
        false;
    }
  }
);

/* ================================
   RECEIVER / DAYBOOK
================================ */
function getModeKeys(
  mode
) {
  return {
    counterKey:
      mode,
    reusableKey:
      mode +
      "Reusable",
    activeKey:
      mode +
      "Active"
  };
}

const MAX_ITEMS_PER_DL_PAGE =
  20;

function chunkItems(
  items,
  size
) {
  const chunks = [];

  for (
    let i = 0;
    i < items.length;
    i += size
  ) {
    chunks.push(
      items.slice(
        i,
        i + size
      )
    );
  }

  return chunks;
}

function getLowestAvailableSerial(
  counter,
  reusable,
  active
) {
  const reusableSorted =
    [...reusable].sort(
      (a, b) =>
        a - b
    );

  if (
    reusableSorted.length
  ) {
    return {
      serial:
        reusableSorted[0],
      source:
        "reusable"
    };
  }

  for (
    let i = 1;
    i <= 100;
    i++
  ) {
    const candidate =
      ((counter +
        i -
        1) %
        100) +
      1;

    if (
      !active.includes(
        candidate
      )
    ) {
      return {
        serial:
          candidate,
        source:
          "new"
      };
    }
  }

  return null;
}

function buildSingleCopyPage(
  billData,
  label,
  itemsChunk,
  isLastPage
) {
  let rows = "";

  itemsChunk.forEach(
    item => {
      rows += `
        <tr>
          <td>${item.productName}</td>
          <td>${shortMaterialName(item.material)}</td>
          <td>${item.qty}</td>
          <td>${formatIndianMoney(item.price)}</td>
          <td>${formatIndianMoney(item.total)}</td>
        </tr>
      `;
    }
  );

  const wholesaleExtras =
    billData.mode ===
      "W" &&
    isLastPage
      ? `
        <div class="print-balance">Balance HV</div>
        <div class="receiver-name-box">
          <div class="receiver-line"></div>
          <div class="receiver-label">Receiver’s Name</div>
        </div>
      `
      : "";

  return `
    <div class="print-wrapper receipt-copy">
      <div class="copy-label">${label}</div>

      <div class="print-header-row">
        <div class="print-customer">
          ${billData.customerName}
        </div>

        <div class="print-serial">
          ${
            billData.serialNumber
              ? "#" +
                billData.serialNumber
              : ""
          }
        </div>
      </div>

      <div class="print-date">
        ${billData.date}
      </div>

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
        Grand Total:
        ₹${billData.grandTotal}
      </div>

      ${wholesaleExtras}
    </div>
  `;
}

function buildReceiptPrintHTML(
  billData
) {
  const chunks =
    chunkItems(
      billData.items,
      MAX_ITEMS_PER_DL_PAGE
    );

  let html = "";

  chunks.forEach(
    (
      chunk,
      index
    ) => {
      html +=
        buildSingleCopyPage(
          billData,
          "CUSTOMER COPY",
          chunk,
          index ===
            chunks.length -
              1
        );
    }
  );

  chunks.forEach(
    (
      chunk,
      index
    ) => {
      html +=
        buildSingleCopyPage(
          billData,
          "OFFICE COPY",
          chunk,
          index ===
            chunks.length -
              1
        );
    }
  );

  return html;
}

function previewReceipt(
  billData
) {
  const chunks =
    chunkItems(
      billData.items,
      MAX_ITEMS_PER_DL_PAGE
    );

  let html = "";

  chunks.forEach(
    (
      chunk,
      index
    ) => {
      html +=
        buildSingleCopyPage(
          billData,
          "VIEW",
          chunk,
          index ===
            chunks.length -
              1
        );
    }
  );

  previewContent.innerHTML =
    html;

  previewModal.style.display =
    "flex";
}

function printReceipt(
  billData
) {
  printInvoice.innerHTML =
    buildReceiptPrintHTML(
      billData
    );

  window.print();
}

function buildDaybookPrintHTML() {
  const entries =
    Object.values(
      daybookCache
    );

  let rows = "";
  let total = 0;

  entries.forEach(
    entry => {
      total +=
        entry.amount;

      rows += `
        <tr>
          <td>${entry.date}</td>
          <td>#${entry.serialNumber}</td>
          <td>${entry.customerName}</td>
          <td>₹${entry.amount}</td>
        </tr>
      `;
    }
  );

  return `
    <div class="print-wrapper">
      <div class="daybook-print-title">DAYBOOK</div>
      <table class="daybook-print-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Sr No</th>
            <th>Customer</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="daybook-print-total">
        TOTAL: ₹${total}
      </div>
    </div>
  `;
}
function printDaybook() {
  printInvoice.innerHTML =
    buildDaybookPrintHTML();

  window.print();

  daybookPrintedOnce =
    true;

  renderDaybook();
}

/* ================================
   UI RENDERERS
================================ */
function renderIncomingBills() {
  const ids =
    Object.keys(
      incomingBillCache
    );

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
    const bill =
      incomingBillCache[id];

    let buttons = "";

    if (
      bill.status ===
      "pending"
    ) {
      buttons = `
        <button
          class="secondary-btn"
          onclick="viewReceivedBill('${id}')"
        >
          View
        </button>

        <button
          class="primary-btn"
          onclick="printReceivedBill('${id}')"
        >
          Print
        </button>
      `;
    } else {
      buttons = `
        <button
          class="secondary-btn"
          onclick="viewReceivedBill('${id}')"
        >
          View
        </button>

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
      `;
    }

    html += `
      <div class="bill-card">
        <div class="bill-title">
          ${bill.customerName}
        </div>

        <div class="badge-row">
          <div class="unit">
            ${bill.date}
          </div>

          <div class="unit">
            ${bill.mode}
          </div>

          ${
            bill.serialNumber
              ? `
                <div class="unit">
                  #${bill.serialNumber}
                </div>
              `
              : ""
          }
        </div>

        <div style="margin-top:12px;font-weight:700;font-size:20px;">
          ₹${bill.grandTotal}
        </div>

        <div
          class="action-buttons"
          style="margin-top:14px;"
        >
          ${buttons}
        </div>
      </div>
    `;
  });

  incomingBills.innerHTML =
    html;
}

function renderDaybook() {
  const entries =
    Object.values(
      daybookCache
    );

  if (!entries.length) {
    daybookSummary.innerHTML =
      "Total: ₹0";

    daybookActions.innerHTML =
      "";

    daybookEntries.innerHTML = `
      <div class="receiver-subtitle">
        No finalized bills
      </div>
    `;

    return;
  }

  const total =
    entries.reduce(
      (
        sum,
        entry
      ) =>
        sum +
        entry.amount,
      0
    );

  daybookSummary.innerHTML =
    `Total: ₹${total}`;

  if (
    !daybookPrintedOnce
  ) {
    daybookActions.innerHTML = `
      <button
        class="primary-btn"
        onclick="printDaybookNow()"
      >
        Print Daybook
      </button>
    `;
  } else {
    daybookActions.innerHTML = `
      <button
        class="primary-btn"
        onclick="reprintDaybookNow()"
      >
        Reprint
      </button>

      <button
        class="delete-btn"
        onclick="deleteDaybookNow()"
      >
        Delete
      </button>
    `;
  }

  let html = "";

  entries.forEach(
    entry => {
      html += `
        <div class="daybook-entry">
          <div class="daybook-date">
            ${entry.date} |
            #${entry.serialNumber}
          </div>

          <div class="daybook-name">
            ${entry.customerName}
          </div>

          <div class="daybook-amount">
            ₹${entry.amount}
          </div>
        </div>
      `;
    }
  );

  daybookEntries.innerHTML =
    html;
}

window.printDaybookNow =
  function() {
    printDaybook();
  };

window.reprintDaybookNow =
  function() {
    printDaybook();
  };

window.deleteDaybookNow =
  async function() {
    if (
      isDaybookBusy
    ) {
      return;
    }

    if (
      !requireAdminPassword()
    ) {
      return;
    }

    isDaybookBusy =
      true;

    try {
      const snapshot =
        await getDocs(
          daybookCollection
        );

      const batch =
        writeBatch(db);

      snapshot.forEach(
        docSnap => {
          batch.delete(
            docSnap.ref
          );
        }
      );

      await batch.commit();

      daybookPrintedOnce =
        false;
    } catch (err) {
      console.error(err);

      alert(
        "Failed to delete daybook."
      );
    } finally {
      isDaybookBusy =
        false;
    }
  };

/* ================================
   FIREBASE LISTENERS
================================ */
onSnapshot(
  billsQuery,
  snapshot => {
    incomingBillCache = {};

    snapshot.forEach(
      docSnap => {
        incomingBillCache[
          docSnap.id
        ] =
          docSnap.data();
      }
    );

    renderIncomingBills();
  }
);

onSnapshot(
  daybookQuery,
  snapshot => {
    daybookCache = {};

    snapshot.forEach(
      docSnap => {
        daybookCache[
          docSnap.id
        ] =
          docSnap.data();
      }
    );

    renderDaybook();
  }
);

/* ================================
   RECEIVER ACTIONS
================================ */
window.viewReceivedBill =
  function(docId) {
    const bill =
      incomingBillCache[
        docId
      ];

    if (!bill) {
      return;
    }

    previewReceipt(
      bill
    );
  };

window.reprintReceivedBill =
  function(docId) {
    const bill =
      incomingBillCache[
        docId
      ];

    if (!bill) {
      return;
    }

    printReceipt(
      bill
    );
  };

window.printReceivedBill =
  async function(docId) {
    if (
      isReceiverBusy
    ) {
      return;
    }

    isReceiverBusy =
      true;

    try {
      const billRef =
        doc(
          db,
          "bills",
          docId
        );

      const finalBill =
        await runTransaction(
          db,
          async transaction => {
            const billSnap =
              await transaction.get(
                billRef
              );

            if (
              !billSnap.exists()
            ) {
              throw new Error(
                "Bill not found."
              );
            }

            const bill =
              billSnap.data();

            if (
              bill.status !==
              "pending"
            ) {
              throw new Error(
                "Bill already processed."
              );
            }

            const serialSnap =
              await transaction.get(
                serialDocRef
              );

            if (
              !serialSnap.exists()
            ) {
              throw new Error(
                "Serial document missing."
              );
            }

            const serialData =
              serialSnap.data();

            const keys =
              getModeKeys(
                bill.mode
              );

            const counter =
              serialData[
                keys.counterKey
              ] || 0;

            const active = [
              ...new Set(
                serialData[
                  keys.activeKey
                ] || []
              )
            ];

            let reusable = [
              ...new Set(
                serialData[
                  keys.reusableKey
                ] || []
              )
            ];

            reusable =
              reusable.filter(
                s =>
                  !active.includes(
                    s
                  )
              );

            const allocation =
              getLowestAvailableSerial(
                counter,
                reusable,
                active
              );

            if (
              !allocation
            ) {
              throw new Error(
                "No serials available."
              );
            }

            const updates = {
              [keys.activeKey]:
                [
                  ...active,
                  allocation.serial
                ]
            };

            if (
              allocation.source ===
              "reusable"
            ) {
              updates[
                keys.reusableKey
              ] =
                reusable.filter(
                  s =>
                    s !==
                    allocation.serial
                );
            } else {
              updates[
                keys.counterKey
              ] =
                allocation.serial;
            }

            transaction.update(
              serialDocRef,
              updates
            );

            transaction.update(
              billRef,
              {
                status:
                  "printed",
                serialNumber:
                  allocation.serial
              }
            );

            return {
              ...bill,
              status:
                "printed",
              serialNumber:
                allocation.serial
            };
          }
        );

      printReceipt(
        finalBill
      );
    } catch (err) {
      console.error(err);

      alert(
        "Failed to print: " +
          err.message
      );
    } finally {
      isReceiverBusy =
        false;
    }
  };

window.doneReceivedBill =
  async function(docId) {
    if (
      isReceiverBusy
    ) {
      return;
    }

    if (
      !requireAdminPassword()
    ) {
      return;
    }

    isReceiverBusy =
      true;

    try {
      const billRef =
        doc(
          db,
          "bills",
          docId
        );

      await runTransaction(
        db,
        async transaction => {
          const billSnap =
            await transaction.get(
              billRef
            );

          if (
            !billSnap.exists()
          ) {
            throw new Error(
              "Bill not found."
            );
          }

          const bill =
            billSnap.data();

          if (
            bill.status !==
            "printed"
          ) {
            throw new Error(
              "Bill must be printed first."
            );
          }

          const serialSnap =
            await transaction.get(
              serialDocRef
            );

          if (
            !serialSnap.exists()
          ) {
            throw new Error(
              "Serial document missing."
            );
          }

          const serialData =
            serialSnap.data();

          const keys =
            getModeKeys(
              bill.mode
            );

          let active = [
            ...new Set(
              serialData[
                keys.activeKey
              ] || []
            )
          ];

          active =
            active.filter(
              s =>
                s !==
                bill.serialNumber
            );

          transaction.update(
            serialDocRef,
            {
              [keys.activeKey]:
                active
            }
          );

          transaction.set(
            doc(
              daybookCollection
            ),
            {
              date:
                bill.date,
              serialNumber:
                bill.serialNumber,
              customerName:
                bill.customerName,
              amount:
                bill.grandTotal,
              createdAt:
                serverTimestamp()
            }
          );

          transaction.delete(
            billRef
          );
        }
      );
    } catch (err) {
      console.error(err);

      alert(
        "Failed to complete bill."
      );
    } finally {
      isReceiverBusy =
        false;
    }
  };
