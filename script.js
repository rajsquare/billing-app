import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  onSnapshot,
  doc,
  setDoc,
  deleteDoc,
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
const liveDraftBillsCollection = collection(db, "liveDraftBills");

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
const DAYBOOK_PRINTED_KEY = "daybookPrintedOnce";
const DRAFT_MAX_AGE_MS =
  24 * 60 * 60 * 1000;

const DISCOUNT_PRODUCTS = new Set([
  "Discount (Less)"
]);

const EDITABLE_NAME_PRODUCTS = new Set([
  "Utensils"
]);

/* ================================
   STATE
================================ */
let products = [];
let billItems = [];
let currentMode = "W";
let currentMaterialFilter = null;

let incomingBillCache = {};
let daybookCache = {};

let isReceiverBusy = false;
let isSendingBill = false;
let isDaybookBusy = false;
let daybookPrintedOnce =
  localStorage.getItem(DAYBOOK_PRINTED_KEY) === "true";

let liveDraftActive = false;
let liveDraftsCache = {};
let liveDraftViewedSessionId = null;
let qtyDirty = false;

let revisionMode = false;
let revisionSourceBillId = null;
let revisionParentBillId = null;
let revisionEmployeeName = "";
let currentRevisionPreviewDocId = null;
let revisionDiffCache = {};

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

const materialFilterDiv =
  document.getElementById("materialFilter");

const liveBtn =
  document.getElementById("liveBtn");
const liveDraftModal =
  document.getElementById("liveDraftModal");
const closeLiveDraftModal =
  document.getElementById("closeLiveDraftModal");
const liveDraftListView =
  document.getElementById("liveDraftListView");
const liveDraftDetailView =
  document.getElementById("liveDraftDetailView");
const liveDraftCards =
  document.getElementById("liveDraftCards");
const liveDraftDetailContent =
  document.getElementById("liveDraftDetailContent");
const liveDraftBackBtn =
  document.getElementById("liveDraftBackBtn");

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

  const dateFmt =
    new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric"
    });

  const timeFmt =
    new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    });

  return {
    displayDate: dateFmt.format(now),
    displayTime: timeFmt.format(now)
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

function formatIndianMoneyWhole(value) {
  return Math.round(Number(value) || 0)
    .toLocaleString("en-IN");
}

function roundQty(value) {
  const n = Math.round(parseFloat(value) * 100) / 100;
  return isNaN(n) ? 0 : n;
}

function isDiscountItem(item) {
  return DISCOUNT_PRODUCTS.has(
    item.product.productName
  );
}

function isEditableNameItem(item) {
  return EDITABLE_NAME_PRODUCTS.has(
    item.product.productName
  );
}

function computeLineTotal(item, price, qty) {
  const raw = Math.round(price * qty * 100) / 100;
  return isDiscountItem(item) ? -raw : raw;
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
            item.qty,
          note:
            item.note || "",
          displayName:
            item.displayName || ""
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

          const restoredItem = {
            product,
            mode:
              savedItem.mode ||
              "W",
            price,
            qty,
            total: 0,
            note:
              savedItem.note || "",
            displayName:
              savedItem.displayName ||
              product.productName
          };
          restoredItem.total =
            computeLineTotal(
              restoredItem,
              price,
              qtyNum
            );
          return restoredItem;
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

    applyModeStyle(currentMode);

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
   LIVE DRAFT HELPERS
================================ */
function getOrCreateSessionId() {
  let id =
    localStorage.getItem(
      "billingSessionId"
    );

  if (!id) {
    id =
      crypto.randomUUID();

    localStorage.setItem(
      "billingSessionId",
      id
    );
  }

  return id;
}

const sessionId =
  getOrCreateSessionId();

function buildDraftPayload() {
  const items =
    billItems.map(item => ({
      productName:
        item.displayName ||
        item.product.productName,
      material:
        item.product.material ||
        "",
      qty:
        roundQty(item.qty) || 0,
      price:
        item.price || 0,
      total:
        item.total || 0
    }));

  const subtotal =
    billItems.reduce(
      (sum, item) =>
        sum + (item.total || 0),
      0
    );

  const sourceSerial =
    revisionMode &&
    revisionSourceBillId &&
    incomingBillCache[revisionSourceBillId]
      ? incomingBillCache[revisionSourceBillId].serialNumber
      : null;

  return {
    sessionId,
    customerName:
      customerName.value.trim() ||
      "WALK-IN",
    mode: currentMode,
    items,
    subtotal:
      Math.round(subtotal),
    itemCount:
      billItems.length,
    updatedAt:
      serverTimestamp(),
    revisionLabel:
      revisionMode
        ? "REVISION" + (sourceSerial ? " #" + sourceSerial : "")
        : null
  };
}

async function syncLiveDraft() {
  if (!billItems.length) {
    if (
      liveDraftActive ||
      liveDraftsCache[sessionId]
    ) {
      await deleteLiveDraft();
    }
    return;
  }

  const payload =
    buildDraftPayload();

  const draftRef =
    doc(
      db,
      "liveDraftBills",
      sessionId
    );

  try {
    await setDoc(
      draftRef,
      payload
    );

    liveDraftActive = true;
  } catch (err) {
    console.error("SYNC FAILURE", err);
  }
}

async function deleteLiveDraft() {
  try {
    const draftRef =
      doc(
        db,
        "liveDraftBills",
        sessionId
      );

    await deleteDoc(draftRef);
    liveDraftActive = false;
  } catch (err) {
    console.error(
      "Live draft delete failed:",
      err
    );
  }
}

function isDraftStale(draft) {
  if (!draft.updatedAt) {
    return false;
  }

  const ms =
    typeof draft.updatedAt.toMillis ===
    "function"
      ? draft.updatedAt.toMillis()
      : 0;

  return (
    Date.now() - ms > 120000
  );
}

function getActiveDrafts() {
  return Object.entries(
    liveDraftsCache
  )
    .map(
      ([id, draft]) => ({
        ...draft,
        _id: id
      })
    )
    .filter(
      draft => !isDraftStale(draft)
    );
}

function renderLiveCount() {
  const count =
    getActiveDrafts().length;

  if (liveBtn) {
    liveBtn.textContent =
      `LIVE (${count})`;

    liveBtn.classList.toggle(
      "live-btn-active",
      count > 0
    );
  }
}

function renderLiveDraftDetail(
  id
) {
  if (!liveDraftDetailContent) {
    return;
  }

  const draft =
    liveDraftsCache[id];

  if (!draft) {
    liveDraftDetailContent.innerHTML =
      `<div class="receiver-subtitle">Draft no longer available.</div>`;
    return;
  }

  const items =
    draft.items || [];

  const rows =
    items
      .map(
        item => `
        <tr>
          <td>${escapeAttr(item.productName)}</td>
          <td>${shortMaterialName(item.material)}</td>
          <td>${item.qty > 0 ? item.qty : "—"}</td>
          <td>${item.price > 0 ? "₹" + formatIndianMoneyWhole(item.price) : "—"}</td>
          <td>${item.qty > 0 && item.price > 0 ? "₹" + formatIndianMoneyWhole(Math.abs(item.total)) : "—"}</td>
        </tr>
      `
      )
      .join("");

  liveDraftDetailContent.innerHTML =
    `
    <div class="live-detail-header">
      <div class="live-detail-name">
        ${escapeAttr(draft.customerName || "WALK-IN")}
      </div>
      <div class="live-detail-meta">
        ${
          draft.mode === "W"
            ? "Wholesale"
            : "Retail"
        } · ${draft.itemCount} item${
          draft.itemCount !== 1
            ? "s"
            : ""
        }
      </div>
      ${draft.revisionLabel
        ? `<div class="live-revision-tag">${escapeAttr(draft.revisionLabel)}</div>`
        : ""}
    </div>

    <table class="live-detail-table">
      <thead>
        <tr>
          <th>Product</th>
          <th>Mat</th>
          <th>Qty</th>
          <th>Rate</th>
          <th>Amt</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="live-detail-total">
      Current Total: ₹${formatIndianMoneyWhole(
        draft.subtotal
      )}
    </div>
  `;
}

function renderLiveDraftList() {
  if (!liveDraftCards) {
    return;
  }

  const active =
    getActiveDrafts();

  if (!active.length) {
    liveDraftCards.innerHTML =
      `<div class="receiver-subtitle" style="padding:16px 0;">No active drafts</div>`;
    return;
  }

  liveDraftCards.innerHTML =
    active
      .map(
        draft => `
        <div
          class="live-draft-card"
          onclick="openLiveDraftDetail('${draft._id}')"
        >
          <div class="live-draft-name">
            ${escapeAttr(draft.customerName || "WALK-IN")}
          </div>
          ${draft.revisionLabel
            ? `<div class="live-revision-tag">${escapeAttr(draft.revisionLabel)}</div>`
            : ""}
          <div class="live-draft-meta">
            <span>${
              draft.mode === "W"
                ? "Wholesale"
                : "Retail"
            }</span>
            <span>${draft.itemCount} item${
              draft.itemCount !== 1
                ? "s"
                : ""
            }</span>
          </div>
          <div class="live-draft-subtotal">
            ₹${formatIndianMoneyWhole(
              draft.subtotal
            )}
          </div>
        </div>
      `
      )
      .join("");
}

function showLiveDraftListView() {
  liveDraftViewedSessionId =
    null;

  if (liveDraftListView) {
    liveDraftListView.style.display =
      "block";
  }

  if (liveDraftDetailView) {
    liveDraftDetailView.style.display =
      "none";
  }
}

window.openLiveDraftDetail =
  function(id) {
    liveDraftViewedSessionId =
      id;

    renderLiveDraftDetail(id);

    if (liveDraftListView) {
      liveDraftListView.style.display =
        "none";
    }

    if (liveDraftDetailView) {
      liveDraftDetailView.style.display =
        "block";
    }
  };

function subscribeToLiveDrafts() {
  onSnapshot(
    liveDraftBillsCollection,
    snapshot => {
      snapshot.docChanges().forEach(
        change => {
          if (
            change.type === "removed"
          ) {
            delete liveDraftsCache[
              change.doc.id
            ];
          } else {
            liveDraftsCache[
              change.doc.id
            ] = change.doc.data();
          }
        }
      );

      renderLiveCount();

      if (
        !liveDraftModal ||
        liveDraftModal.style.display ===
          "none"
      ) {
        return;
      }

      if (
        liveDraftViewedSessionId &&
        liveDraftsCache[liveDraftViewedSessionId]
      ) {
        renderLiveDraftDetail(
          liveDraftViewedSessionId
        );
      } else {
        showLiveDraftListView();
        renderLiveDraftList();
      }
    },
    err => {
      console.error("LISTENER ERROR", err);
    }
  );
}

/* ================================
   REVISION HELPERS
================================ */
function buildRevisionSummary() {
  const count = billItems.length;
  const total = Math.round(
    billItems.reduce((s, i) => s + i.total, 0)
  );
  return `${count} item${count !== 1 ? "s" : ""}, ₹${total}`;
}

function exitRevisionMode() {
  revisionMode = false;
  revisionSourceBillId = null;
  revisionParentBillId = null;
  revisionEmployeeName = "";
  renderRevisionBanner();
}

function renderRevisionBanner() {
  const banner =
    document.getElementById(
      "revisionBanner"
    );

  if (!banner) return;

  if (!revisionMode) {
    banner.style.display = "none";
    return;
  }

  const sourceBill =
    incomingBillCache[revisionSourceBillId];

  const serialStr =
    sourceBill && sourceBill.serialNumber
      ? " · #" + sourceBill.serialNumber
      : "";

  banner.style.display = "flex";
  banner.innerHTML = `
    <span>REVISION MODE — ${escapeAttr(revisionEmployeeName)}${serialStr}</span>
    <button onclick="cancelRevision()">Cancel</button>
  `;
}

function getBillChainIds(docId) {
  const bill = incomingBillCache[docId];

  if (!bill) return [docId];

  const originalId =
    bill.isOriginal === false
      ? bill.parentBillId
      : docId;

  if (!originalId) return [docId];

  const ids = new Set([originalId]);

  Object.entries(incomingBillCache).forEach(
    ([id, b]) => {
      if (b.parentBillId === originalId) {
        ids.add(id);
      }
    }
  );

  return [...ids];
}

/* ================================
   REVISION DIFF + PRINT BUILDERS
================================ */
function buildRevisionDiff(
  originalBill,
  revisedBill
) {
  const origItems =
    originalBill.items || [];
  const revItems =
    revisedBill.items || [];

  const origMap = new Map();
  origItems.forEach(item => {
    const key =
      item.productName +
      "||" +
      (item.material || "");
    origMap.set(key, item);
  });

  const revMap = new Map();
  revItems.forEach(item => {
    const key =
      item.productName +
      "||" +
      (item.material || "");
    revMap.set(key, item);
  });

  const added = [];
  const removed = [];
  const changed = [];
  const unchanged = [];

  origItems.forEach(origItem => {
    const key =
      origItem.productName +
      "||" +
      (origItem.material || "");
    const revItem = revMap.get(key);

    if (!revItem) {
      removed.push(origItem);
    } else {
      const qtyChanged =
        roundQty(origItem.qty) !==
        roundQty(revItem.qty);
      const priceChanged =
        parseFloat(origItem.price) !==
        parseFloat(revItem.price);

      if (qtyChanged || priceChanged) {
        changed.push({
          originalItem: origItem,
          revisedItem: revItem,
          qtyChanged,
          priceChanged
        });
      } else {
        unchanged.push(revItem);
      }
    }
  });

  revItems.forEach(revItem => {
    const key =
      revItem.productName +
      "||" +
      (revItem.material || "");
    if (!origMap.has(key)) {
      added.push(revItem);
    }
  });

  const customerNameChanged =
    (originalBill.customerName || "") !==
    (revisedBill.customerName || "");

  return {
    added,
    removed,
    changed,
    unchanged,
    customerNameChanged,
    originalCustomerName:
      originalBill.customerName,
    revisedCustomerName:
      revisedBill.customerName
  };
}

function buildDiffSummary(diff) {
  const hasAdded =
    diff.added.length > 0;
  const hasRemoved =
    diff.removed.length > 0;
  const hasPriceChange =
    diff.changed.some(
      c => c.priceChanged
    );
  const hasQtyChange =
    diff.changed.some(
      c => c.qtyChanged
    );
  const hasAdjusted =
    hasPriceChange || hasQtyChange;

  const a = diff.added.length;
  const r = diff.removed.length;

  if (hasAdded && hasRemoved && hasAdjusted) {
    return "Items added, removed, and adjusted";
  }
  if (hasAdded && hasRemoved) {
    return `${a} item${a !== 1 ? "s" : ""} added, ${r} removed`;
  }
  if (hasAdded && hasAdjusted) {
    return `${a} item${a !== 1 ? "s" : ""} added and adjusted`;
  }
  if (hasRemoved && hasAdjusted) {
    return `${r} item${r !== 1 ? "s" : ""} removed and adjusted`;
  }
  if (hasAdded) {
    return `${a} item${a !== 1 ? "s" : ""} added`;
  }
  if (hasRemoved) {
    return `${r} item${r !== 1 ? "s" : ""} removed`;
  }
  if (hasPriceChange && hasQtyChange) {
    return "Prices and quantities adjusted";
  }
  if (hasPriceChange) {
    return "Prices adjusted";
  }
  if (hasQtyChange) {
    return "Quantities adjusted";
  }
  if (diff.customerNameChanged) {
    return "Customer name changed";
  }
  return "No changes";
}

function buildMergedOfficeItems(
  originalBill,
  revisedBill,
  diff
) {
  const removedKeys = new Set(
    diff.removed.map(
      item =>
        item.productName +
        "||" +
        (item.material || "")
    )
  );

  const changedMap = new Map();
  diff.changed.forEach(c => {
    const key =
      c.revisedItem.productName +
      "||" +
      (c.revisedItem.material || "");
    changedMap.set(key, c);
  });

  const origChron =
    [...(originalBill.items || [])].reverse();

  const revItemsByKey = new Map();
  (revisedBill.items || []).forEach(item => {
    const key =
      item.productName +
      "||" +
      (item.material || "");
    revItemsByKey.set(key, item);
  });

  const merged = [];

  origChron.forEach(origItem => {
    const key =
      origItem.productName +
      "||" +
      (origItem.material || "");

    if (removedKeys.has(key)) {
      merged.push({
        ...origItem,
        _removed: true
      });
    } else if (changedMap.has(key)) {
      const c = changedMap.get(key);
      merged.push({
        ...c.revisedItem,
        _qtyChanged: c.qtyChanged,
        _priceChanged: c.priceChanged
      });
    } else {
      const revItem =
        revItemsByKey.get(key);
      merged.push({
        ...(revItem || origItem)
      });
    }
  });

  const addedChron =
    [...diff.added].reverse();

  addedChron.forEach(item => {
    merged.push({
      ...item,
      _added: true
    });
  });

  return merged;
}

function buildRevisionOfficeSinglePage(
  revisedBill,
  originalBill,
  mergedChunk,
  diff,
  isLastPage,
  pageNum,
  totalPages
) {
  let rowIdx = 0;
  let rows = "";

  mergedChunk.forEach(item => {
    if (item._removed) {
      rows += `
        <tr class="print-row-removed">
          <td>-</td>
          <td>${escapeAttr(item.productName)}${item.note ? `<br><span class="print-item-note">${escapeAttr(item.note)}</span>` : ""}</td>
          <td>${shortMaterialName(item.material)}</td>
          <td>${roundQty(item.qty)}</td>
          <td>${formatIndianMoney(item.price)}</td>
          <td>${formatIndianMoney(item.total)}</td>
        </tr>
      `;
    } else {
      const n = ++rowIdx;

      const qtyCell =
        item._qtyChanged
          ? `<td class="print-cell-changed">${roundQty(item.qty)}</td>`
          : `<td>${roundQty(item.qty)}</td>`;

      const priceCell =
        item._priceChanged
          ? `<td class="print-cell-changed">${formatIndianMoney(item.price)}</td>`
          : `<td>${formatIndianMoney(item.price)}</td>`;

      const trClass =
        item._added
          ? ' class="print-row-added"'
          : "";

      rows += `
        <tr${trClass}>
          <td>${n}</td>
          <td>${escapeAttr(item.productName)}${item.note ? `<br><span class="print-item-note">${escapeAttr(item.note)}</span>` : ""}</td>
          <td>${shortMaterialName(item.material)}</td>
          ${qtyCell}
          ${priceCell}
          <td>${formatIndianMoney(item.total)}</td>
        </tr>
      `;
    }
  });

  const custName =
    revisedBill.customerName &&
    revisedBill.customerName !== "Retail Bill"
      ? diff.customerNameChanged
        ? `<div class="print-customer print-cell-changed-block">${escapeAttr(revisedBill.customerName)}</div>`
        : `<div class="print-customer">${escapeAttr(revisedBill.customerName)}</div>`
      : "";

  const wholesaleExtras =
    revisedBill.mode === "W" && isLastPage
      ? `
        <div class="receiver-section-divider"></div>
        <div class="receiver-name-box-large">
          <div class="receiver-label-large">Receiver's Name:</div>
        </div>
      `
      : "";

  const revMeta = isLastPage
    ? `
      <div class="print-revised-meta">
        Revised by: ${escapeAttr(revisedBill.revisedBy || "—")}${revisedBill.time ? " | " + escapeAttr(revisedBill.time) : ""}
      </div>
      <div class="print-revised-summary">(${buildDiffSummary(diff)})</div>
    `
    : "";

  return `
    <div class="print-wrapper receipt-copy" style="position:relative;">
      <div class="copy-label">OFFICE COPY</div>

      <div class="print-revised-wm-overlay">
        <span>REVISED BILL</span>
        <span>REVISED BILL</span>
        <span>REVISED BILL</span>
        <span>REVISED BILL</span>
      </div>

      <div class="print-header-row">
        ${custName}
        <div class="print-date-serial-row">
          <span class="print-date">${escapeAttr(revisedBill.date)}</span>
          <span class="print-serial">${revisedBill.serialNumber ? "#" + escapeAttr(revisedBill.serialNumber) : ""}</span>
        </div>
        ${revisedBill.time
          ? `<div class="print-office-time">${escapeAttr(revisedBill.time)}</div>`
          : ""}
      </div>

      <table class="print-table">
        <thead>
          <tr>
            <th>S</th>
            <th>Product</th>
            <th>Mat</th>
            <th>Qty</th>
            <th>Rate</th>
            <th>Amt</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <div class="print-total">
        Grand Total: ₹${formatIndianMoneyWhole(revisedBill.grandTotal)}/-
      </div>

      ${revMeta}
      ${wholesaleExtras}

      ${totalPages > 1
        ? `<div class="bill-page-watermark">${pageNum} / ${totalPages}</div>`
        : ""}
    </div>
  `;
}

function buildRevisionAuditPreviewHTML(
  revisedBill,
  originalBill,
  diff
) {
  const mergedItems =
    buildMergedOfficeItems(
      originalBill,
      revisedBill,
      diff
    );

  const chunks =
    chunkItems(
      mergedItems,
      MAX_ITEMS_PER_DL_PAGE
    );

  const totalPages = chunks.length;
  let html = "";

  chunks.forEach((chunk, index) => {
    html += buildRevisionOfficeSinglePage(
      revisedBill,
      originalBill,
      chunk,
      diff,
      index === totalPages - 1,
      index + 1,
      totalPages
    );
  });

  return html;
}

function buildRevisionReceiptPrintHTML(
  revisedBill,
  originalBill
) {
  const diff =
    buildRevisionDiff(
      originalBill,
      revisedBill
    );

  const customerItems =
    [...revisedBill.items].reverse();

  const customerChunks =
    chunkItems(
      customerItems,
      MAX_ITEMS_PER_DL_PAGE
    );

  const mergedItems =
    buildMergedOfficeItems(
      originalBill,
      revisedBill,
      diff
    );

  const officeChunks =
    chunkItems(
      mergedItems,
      MAX_ITEMS_PER_DL_PAGE
    );

  let html = "";

  customerChunks.forEach((chunk, index) => {
    html += buildSingleCopyPage(
      revisedBill,
      "CUSTOMER COPY",
      chunk,
      index === customerChunks.length - 1,
      index + 1,
      customerChunks.length
    );
  });

  officeChunks.forEach((chunk, index) => {
    html += buildRevisionOfficeSinglePage(
      revisedBill,
      originalBill,
      chunk,
      diff,
      index === officeChunks.length - 1,
      index + 1,
      officeChunks.length
    );
  });

  return html;
}

function printRevisionReceipt(
  revisedBill,
  originalBill
) {
  printInvoice.innerHTML =
    buildRevisionReceiptPrintHTML(
      revisedBill,
      originalBill
    );

  window.print();
}

function openRevisionPreview(
  docId,
  mode
) {
  const bill =
    incomingBillCache[docId];

  if (!bill) return;

  currentRevisionPreviewDocId = docId;

  const tabs =
    document.getElementById(
      "revisionViewTabs"
    );
  const origBtn =
    document.getElementById(
      "revisionViewOriginalBtn"
    );
  const revBtn =
    document.getElementById(
      "revisionViewRevisedBtn"
    );

  if (tabs) {
    tabs.style.display = "flex";
    if (origBtn) {
      origBtn.classList.toggle(
        "revision-view-tab-active",
        mode === "original"
      );
    }
    if (revBtn) {
      revBtn.classList.toggle(
        "revision-view-tab-active",
        mode === "revised"
      );
    }
  }

  const originalBill =
    incomingBillCache[bill.parentBillId];

  if (mode === "original") {
    if (!originalBill) {
      const chunks =
        chunkItems(
          [...bill.items].reverse(),
          MAX_ITEMS_PER_DL_PAGE
        );
      let html = "";
      chunks.forEach((chunk, index) => {
        html += buildSingleCopyPage(
          bill,
          "VIEW",
          chunk,
          index === chunks.length - 1,
          index + 1,
          chunks.length
        );
      });
      previewContent.innerHTML = html;
    } else {
      const chunks =
        chunkItems(
          [...originalBill.items].reverse(),
          MAX_ITEMS_PER_DL_PAGE
        );
      let html = "";
      chunks.forEach((chunk, index) => {
        html += buildSingleCopyPage(
          originalBill,
          "VIEW",
          chunk,
          index === chunks.length - 1,
          index + 1,
          chunks.length
        );
      });
      previewContent.innerHTML = html;
    }
  } else {
    if (!originalBill) {
      const chunks =
        chunkItems(
          [...bill.items].reverse(),
          MAX_ITEMS_PER_DL_PAGE
        );
      let html = "";
      chunks.forEach((chunk, index) => {
        html += buildSingleCopyPage(
          bill,
          "VIEW",
          chunk,
          index === chunks.length - 1,
          index + 1,
          chunks.length
        );
      });
      previewContent.innerHTML = html;
    } else {
      if (!revisionDiffCache[docId]) {
        revisionDiffCache[docId] =
          buildRevisionDiff(
            originalBill,
            bill
          );
      }
      previewContent.innerHTML =
        buildRevisionAuditPreviewHTML(
          bill,
          originalBill,
          revisionDiffCache[docId]
        );
    }
  }

  previewModal.style.display = "flex";
}

window.switchRevisionView =
  function(mode) {
    if (!currentRevisionPreviewDocId) {
      return;
    }
    openRevisionPreview(
      currentRevisionPreviewDocId,
      mode
    );
  };

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
    .filter(result => {
      if (result.score <= 0) return false;
      if (
        currentMaterialFilter &&
        result.product.material !== currentMaterialFilter
      ) return false;
      return true;
    })
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
function applyModeStyle(mode) {
  modeToggle.innerText = mode;
  modeToggle.style.background =
    mode === "W" ? "#2f3f64" : "#d65353";
}

modeToggle.addEventListener(
  "click",
  () => {
    currentMode =
      currentMode === "W" ? "R" : "W";
    applyModeStyle(currentMode);

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

/* ================================
   MATERIAL FILTER
================================ */
materialFilterDiv.addEventListener(
  "click",
  e => {
    const chip =
      e.target.closest(".filter-chip");

    if (!chip) return;

    const material =
      chip.dataset.material || null;

    currentMaterialFilter =
      currentMaterialFilter === material
        ? null
        : material;

    materialFilterDiv
      .querySelectorAll(".filter-chip")
      .forEach(c => {
        const chipMaterial =
          c.dataset.material || null;
        c.classList.toggle(
          "active",
          chipMaterial === currentMaterialFilter
        );
      });

    if (searchBox.value.trim()) {
      renderSuggestions(
        searchProducts(searchBox.value)
      );
    }
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
              ${escapeAttr(product.productName)}
            </div>

            <div class="suggestion-price">
              ${getCurrentPrice(product) ? `₹${formatIndianMoneyWhole(getCurrentPrice(product))}` : "-"}
            </div>
          </div>

          <div class="badge-row">
            <div class="unit">
              ${escapeAttr(product.priceType || "")}
            </div>

            ${
              product.material
                ? `
                  <div class="unit ${getMaterialClass(product.material)}">
                    ${escapeAttr(product.material)}
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

    billItems.unshift({
      product,
      mode:
        currentMode,
      price:
        getCurrentPrice(
          product
        ) || 0,
      qty: "",
      total: 0,
      note: "",
      displayName:
        product.productName
    });

    renderBill();
    updateGrandTotal();
    saveDraft();
    syncLiveDraft();
    qtyDirty = false;

    searchBox.value = "";
    suggestions.innerHTML =
      "";
    clearSearch.style.display =
      "none";

    currentMaterialFilter = null;
    materialFilterDiv
      .querySelectorAll(".filter-chip")
      .forEach(c => {
        const chipMaterial =
          c.dataset.material || null;
        c.classList.toggle(
          "active",
          chipMaterial === null
        );
      });

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

      const safeDisplayName =
        escapeAttr(
          item.displayName ||
          item.product.productName
        );

      html += `
        <div class="bill-card">
          <div class="bill-title">
            ${
              isEditableNameItem(item)
                ? `<input
                    class="bill-name-input"
                    type="text"
                    value="${safeDisplayName}"
                    placeholder="Product name"
                    oninput="updateDisplayName(${index}, this.value)"
                  >`
                : escapeAttr(item.displayName || item.product.productName)
            }
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
              placeholder="Quantity"
              value="${safeQty}"
              data-qty-index="${index}"
              oninput="updateQty(${index}, this.value)"
              onblur="commitQty()"
              onkeydown="if(event.key==='Enter'){commitQty()}"
            >

            <input
              class="bill-input"
              type="text"
              inputmode="decimal"
              placeholder="Price"
              value="${safePrice}"
              oninput="updatePrice(${index}, this.value)"
            >

          </div>

          ${
            isDiscountItem(item)
              ? `<input
                  class="bill-input discount-note-input"
                  type="text"
                  placeholder="Note (optional)"
                  value="${escapeAttr(item.note || '')}"
                  oninput="updateNote(${index}, this.value)"
                >`
              : ""
          }

          <div class="bill-bottom">
            <div class="line-total" ${isDiscountItem(item) ? 'style="color:#d65353;"' : ''}>
              ${isDiscountItem(item) ? "-" : ""}₹${formatIndianMoney(Math.abs(item.total))}
            </div>

            <div class="bill-row-actions">
              <button
                class="delete-btn"
                onclick="deleteItem(${index})"
              >
                Remove
              </button>
            </div>
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

    billItems[index].qty =
      value;

    const qty =
      roundQty(value);

    billItems[index].total =
      computeLineTotal(
        billItems[index],
        billItems[index].price,
        qty
      );

    updateGrandTotal();
    saveDraft();
    qtyDirty = true;

    const totalEl =
      billItemsDiv.querySelectorAll(
        ".line-total"
      )[index];

    if (totalEl) {
      const item = billItems[index];
      totalEl.style.color =
        isDiscountItem(item) ? "#d65353" : "";
      totalEl.innerText =
        `${isDiscountItem(item) ? "-" : ""}₹${formatIndianMoney(Math.abs(item.total))}`;
    }
  };

window.commitQty =
  function() {
    if (!qtyDirty) {
      return;
    }

    qtyDirty = false;
    syncLiveDraft();
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
      roundQty(
        billItems[index].qty
      );

    billItems[index].total =
      computeLineTotal(
        billItems[index],
        billItems[index].price,
        qty
      );

    updateGrandTotal();
    saveDraft();

    const totalEl =
      billItemsDiv.querySelectorAll(
        ".line-total"
      )[index];

    if (totalEl) {
      const item = billItems[index];
      totalEl.style.color =
        isDiscountItem(item) ? "#d65353" : "";
      totalEl.innerText =
        `${isDiscountItem(item) ? "-" : ""}₹${formatIndianMoney(Math.abs(item.total))}`;
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

    if (!billItems.length) {
      deleteLiveDraft();
    }
  };

window.updateNote =
  function(index, value) {
    if (!billItems[index]) return;
    billItems[index].note = value;
    saveDraft();
  };

window.updateDisplayName =
  function(index, value) {
    if (!billItems[index]) return;
    billItems[index].displayName = value;
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
    `₹${formatIndianMoneyWhole(total)}`;
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

  const modalTitle =
    printModal.querySelector(
      ".modal-title"
    );

  if (modalTitle) {
    modalTitle.textContent =
      revisionMode
        ? "Send Revision"
        : "Send Details";
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

    const revTabs =
      document.getElementById(
        "revisionViewTabs"
      );

    if (revTabs) {
      revTabs.style.display = "none";
    }

    currentRevisionPreviewDocId =
      null;

    revisionDiffCache = {};
  }
);

liveBtn.addEventListener(
  "click",
  () => {
    showLiveDraftListView();
    renderLiveDraftList();
    liveDraftModal.style.display =
      "flex";
  }
);

closeLiveDraftModal.addEventListener(
  "click",
  () => {
    liveDraftModal.style.display =
      "none";
    liveDraftViewedSessionId =
      null;
  }
);

liveDraftBackBtn.addEventListener(
  "click",
  () => {
    showLiveDraftListView();
    renderLiveDraftList();
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

  const isCashOverride =
    currentMode === "W" &&
    customerName.value.trim().toLowerCase() === "cash";

  const effectiveMode =
    isCashOverride ? "R" : currentMode;

  return {
    mode:
      effectiveMode,

    date:
      indiaDate.displayDate,

    time:
      indiaDate.displayTime,

    customerName:
      effectiveMode === "W"
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

    isOriginal:
      !revisionMode,

    parentBillId:
      revisionMode
        ? revisionParentBillId
        : null,

    effectiveVersion:
      true,

    isLocked:
      false,

    revisedBy:
      revisionMode
        ? revisionEmployeeName
        : null,

    revisedAt:
      revisionMode
        ? serverTimestamp()
        : null,

    revisionSummary:
      revisionMode
        ? buildRevisionSummary()
        : null,

    items:
      billItems.map(
        item => ({
          productName:
            item.displayName ||
            item.product.productName,

          material:
            item.product
              .material || "",

          qty:
            roundQty(item.qty),

          price:
            item.price,

          total:
            item.total,

          note:
            item.note || ""
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

      if (revisionMode) {
        const sourceRef =
          doc(
            db,
            "bills",
            revisionSourceBillId
          );

        const newRevRef =
          doc(billsCollection);

        await runTransaction(
          db,
          async transaction => {
            const sourceSnap =
              await transaction.get(
                sourceRef
              );

            if (
              !sourceSnap.exists()
            ) {
              throw new Error(
                "Source bill no longer exists."
              );
            }

            const sourceData =
              sourceSnap.data();

            if (sourceData.serialNumber) {
              billData.serialNumber =
                sourceData.serialNumber;
              billData.status =
                "printed";
            }

            transaction.set(
              newRevRef,
              billData
            );

            transaction.update(
              sourceRef,
              {
                effectiveVersion:
                  false
              }
            );
          }
        );

        exitRevisionMode();
      } else {
        await addDoc(
          billsCollection,
          billData
        );
      }

      billItems = [];
      customerName.value =
        "";

      renderBill();
      updateGrandTotal();
      clearDraft();
      deleteLiveDraft();

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
   REVISION ACTIONS
================================ */
window.reviseBill =
  async function(docId) {
    const bill =
      incomingBillCache[docId];

    if (!bill) return;

    if (bill.isLocked === true) {
      alert(
        "This bill is locked and cannot be revised."
      );
      return;
    }

    const empInput =
      prompt(
        "Enter Employee ID"
      );

    if (empInput === null) return;

    if (!empInput.trim()) {
      alert(
        "Employee ID is required."
      );
      return;
    }

    const parentId =
      bill.isOriginal === false
        ? bill.parentBillId
        : docId;

    const restoredItems =
      (bill.items || []).map(
        savedItem => {
          let product =
            products.find(
              p =>
                p.productName ===
                  savedItem.productName &&
                (!savedItem.material ||
                  p.material ===
                    savedItem.material)
            );

          if (!product) {
            product = {
              sr: -1,
              productName:
                savedItem.productName,
              material:
                savedItem.material || "",
              priceType: "",
              wPrice:
                savedItem.price,
              rPrice:
                savedItem.price,
              searchableText:
                normalize(
                  savedItem.productName
                ),
              searchableTokens:
                tokenize(
                  savedItem.productName
                )
            };
          }

          const price =
            parseFloat(
              savedItem.price
            ) || 0;

          const qty =
            String(
              savedItem.qty || ""
            );

          const qtyNum =
            parseFloat(qty) || 0;

          const item = {
            product,
            mode:
              bill.mode || "W",
            price,
            qty,
            note:
              savedItem.note || "",
            displayName:
              savedItem.productName ||
              product.productName,
            total: 0
          };

          item.total =
            computeLineTotal(
              item,
              price,
              qtyNum
            );

          return item;
        }
      );

    revisionMode = true;
    revisionSourceBillId = docId;
    revisionParentBillId = parentId;
    revisionEmployeeName =
      empInput.trim();

    currentMode =
      bill.mode || "W";

    applyModeStyle(currentMode);

    if (
      currentMode === "W" &&
      bill.customerName &&
      bill.customerName !== "Retail Bill"
    ) {
      customerName.value =
        bill.customerName;
    } else {
      customerName.value = "";
    }

    billItems = restoredItems;
    renderBill();
    updateGrandTotal();
    saveDraft();
    syncLiveDraft();

    renderRevisionBanner();
    activateView("billing");
  };

window.cancelRevision =
  function() {
    if (
      !confirm(
        "Cancel revision? Changes will be lost."
      )
    ) {
      return;
    }

    exitRevisionMode();
    billItems = [];
    customerName.value = "";
    renderBill();
    updateGrandTotal();
    clearDraft();
    deleteLiveDraft();
  };

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
  25;

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

  const activeSet =
    new Set(active);

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
      !activeSet.has(
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
  isLastPage,
  pageNum,
  totalPages
) {
  let rows = "";

  itemsChunk.forEach(
    (item, idx) => {
      rows += `
        <tr>
          <td>${idx + 1}</td>
          <td>${escapeAttr(item.productName)}${item.note ? `<br><span class="print-item-note">${escapeAttr(item.note)}</span>` : ""}</td>
          <td>${shortMaterialName(item.material)}</td>
          <td>${roundQty(item.qty)}</td>
          <td>${formatIndianMoney(item.price)}</td>
          <td>${formatIndianMoney(item.total)}</td>
        </tr>
      `;
    }
  );

  const isCustomerCopy =
    label === "CUSTOMER COPY";

  const customerFooterText =
    billData.grandTotal < 0
      ? "Return HV"
      : "Balance HV";

  const wholesaleExtras =
    billData.mode ===
      "W" &&
    isLastPage
      ? isCustomerCopy
        ? `<div class="print-balance print-balance-large">${customerFooterText}</div>`
        : `
          <div class="receiver-section-divider"></div>
          <div class="receiver-name-box-large">
            <div class="receiver-label-large">Receiver’s Name:</div>
          </div>
        `
      : "";

  return `
    <div class="print-wrapper receipt-copy">
      <div class="copy-label">${label}</div>

      <div class="print-header-row">
        ${billData.customerName && billData.customerName !== "Retail Bill"
          ? `<div class="print-customer">${escapeAttr(billData.customerName)}</div>`
          : ""}

        <div class="print-date-serial-row">
          <span class="print-date">${escapeAttr(billData.date)}</span>
          <span class="print-serial">${billData.serialNumber ? "#" + escapeAttr(billData.serialNumber) : ""}</span>
        </div>

        ${!isCustomerCopy && billData.time
          ? `<div class="print-office-time">${escapeAttr(billData.time)}</div>`
          : ""}
      </div>

      <table class="print-table">
        <thead>
          <tr>
            <th>S</th>
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
        Grand Total: ₹${formatIndianMoneyWhole(billData.grandTotal)}/-
      </div>

      ${wholesaleExtras}

      ${totalPages > 1
        ? `<div class="bill-page-watermark">${pageNum} / ${totalPages}</div>`
        : ""}
    </div>
  `;
}

function buildReceiptPrintHTML(
  billData
) {
  const chunks =
    chunkItems(
      [...billData.items].reverse(),
      MAX_ITEMS_PER_DL_PAGE
    );

  const totalPages =
    chunks.length;

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
          index === totalPages - 1,
          index + 1,
          totalPages
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
          index === totalPages - 1,
          index + 1,
          totalPages
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
      [...billData.items].reverse(),
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

  const wEntries =
    entries.filter(
      e => (e.mode || "W") === "W"
    );

  const rEntries =
    entries.filter(
      e => (e.mode || "W") === "R"
    );

  const wTotal =
    wEntries.reduce(
      (sum, e) => sum + e.amount,
      0
    );

  const rTotal =
    rEntries.reduce(
      (sum, e) => sum + e.amount,
      0
    );

  const total = wTotal + rTotal;

  function buildRows(group) {
    return group
      .map(entry => `
        <tr>
          <td>${escapeAttr(entry.date)}</td>
          <td>#${escapeAttr(entry.serialNumber)}</td>
          <td>${escapeAttr(entry.customerName)}</td>
          <td>₹${formatIndianMoneyWhole(entry.amount)}</td>
        </tr>
      `)
      .join("");
  }

  let tbody = "";

  if (wEntries.length) {
    tbody += `
        <tr class="daybook-group-row">
          <th colspan="4">W Bills</th>
        </tr>
        ${buildRows(wEntries)}
        <tr class="daybook-subtotal-row">
          <td colspan="3">W Total</td>
          <td>₹${formatIndianMoneyWhole(wTotal)}</td>
        </tr>
    `;
  }

  if (rEntries.length) {
    tbody += `
        <tr class="daybook-group-row">
          <th colspan="4">R Bills</th>
        </tr>
        ${buildRows(rEntries)}
        <tr class="daybook-subtotal-row">
          <td colspan="3">R Total</td>
          <td>₹${formatIndianMoneyWhole(rTotal)}</td>
        </tr>
    `;
  }

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
        <tbody>${tbody}</tbody>
      </table>
      <div class="daybook-print-total">
        TOTAL: ₹${formatIndianMoneyWhole(total)}
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

  localStorage.setItem(
    DAYBOOK_PRINTED_KEY,
    "true"
  );

  renderDaybook();
}

/* ================================
   UI RENDERERS
================================ */
function renderIncomingBills() {
  const ids =
    Object.keys(
      incomingBillCache
    )
    .filter(id => {
      const b = incomingBillCache[id];
      return b.effectiveVersion !== false;
    })
    .reverse();

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

    const isLocked =
      bill.isLocked === true;

    const reviseBtnHtml =
      isLocked
        ? ""
        : `
          <button
            class="revise-btn"
            onclick="reviseBill('${id}')"
          >
            Revise Bill
          </button>
        `;

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

        ${reviseBtnHtml}
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

        ${reviseBtnHtml}

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
          ${escapeAttr(bill.customerName)}
        </div>

        <div class="badge-row">
          <div class="unit">
            ${escapeAttr(bill.date)}
          </div>

          <div class="unit">
            ${escapeAttr(bill.mode)}
          </div>

          ${
            bill.serialNumber
              ? `
                <div class="unit">
                  #${escapeAttr(bill.serialNumber)}
                </div>
              `
              : ""
          }
        </div>

        <div style="margin-top:12px;font-weight:700;font-size:20px;">
          ₹${formatIndianMoneyWhole(bill.grandTotal)}
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

  const wEntries =
    entries.filter(
      e => (e.mode || "W") === "W"
    );

  const rEntries =
    entries.filter(
      e => (e.mode || "W") === "R"
    );

  const wTotal =
    wEntries.reduce(
      (sum, e) => sum + e.amount,
      0
    );

  const rTotal =
    rEntries.reduce(
      (sum, e) => sum + e.amount,
      0
    );

  const total = wTotal + rTotal;

  daybookSummary.innerHTML =
    `Total: ₹${formatIndianMoneyWhole(total)}`;

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

  function entryCard(entry) {
    return `
      <div class="daybook-entry">
        <div class="daybook-date">
          ${escapeAttr(entry.date)} |
          #${escapeAttr(entry.serialNumber)}
        </div>

        <div class="daybook-name">
          ${escapeAttr(entry.customerName)}
        </div>

        <div class="daybook-amount">
          ₹${formatIndianMoneyWhole(entry.amount)}
        </div>
      </div>
    `;
  }

  let html = "";

  if (wEntries.length) {
    html +=
      `<div class="daybook-group-label">W Bills</div>`;

    wEntries.forEach(
      entry => { html += entryCard(entry); }
    );

    html +=
      `<div class="daybook-subtotal">W Total: ₹${formatIndianMoneyWhole(wTotal)}</div>`;
  }

  if (rEntries.length) {
    html +=
      `<div class="daybook-group-label">R Bills</div>`;

    rEntries.forEach(
      entry => { html += entryCard(entry); }
    );

    html +=
      `<div class="daybook-subtotal">R Total: ₹${formatIndianMoneyWhole(rTotal)}</div>`;
  }

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

      localStorage.removeItem(
        DAYBOOK_PRINTED_KEY
      );
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
subscribeToLiveDrafts();

onSnapshot(
  billsQuery,
  snapshot => {
    snapshot.docChanges().forEach(
      change => {
        if (
          change.type === "removed"
        ) {
          delete incomingBillCache[
            change.doc.id
          ];
        } else {
          incomingBillCache[
            change.doc.id
          ] =
            change.doc.data();
        }
        // Invalidate memoized diff if this bill's data changed.
        delete revisionDiffCache[
          change.doc.id
        ];
      }
    );

    renderIncomingBills();
  }
);

onSnapshot(
  daybookQuery,
  snapshot => {
    snapshot.docChanges().forEach(
      change => {
        if (
          change.type === "removed"
        ) {
          delete daybookCache[
            change.doc.id
          ];
        } else {
          daybookCache[
            change.doc.id
          ] =
            change.doc.data();
        }
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
      incomingBillCache[docId];

    if (!bill) return;

    if (
      bill.isOriginal === false &&
      bill.parentBillId
    ) {
      openRevisionPreview(
        docId,
        "revised"
      );
      return;
    }

    const revTabs =
      document.getElementById(
        "revisionViewTabs"
      );

    if (revTabs) {
      revTabs.style.display = "none";
    }

    currentRevisionPreviewDocId = null;

    previewReceipt(bill);
  };

window.reprintReceivedBill =
  function(docId) {
    const bill =
      incomingBillCache[docId];

    if (!bill) return;

    if (
      bill.isOriginal === false &&
      bill.parentBillId
    ) {
      const originalBill =
        incomingBillCache[
          bill.parentBillId
        ];

      if (originalBill) {
        printRevisionReceipt(
          bill,
          originalBill
        );
        return;
      }
    }

    printReceipt(bill);
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

      if (
        finalBill.isOriginal === false &&
        finalBill.parentBillId
      ) {
        const originalBill =
          incomingBillCache[
            finalBill.parentBillId
          ];

        if (originalBill) {
          printRevisionReceipt(
            finalBill,
            originalBill
          );
        } else {
          printReceipt(finalBill);
        }
      } else {
        printReceipt(finalBill);
      }
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

    const billRef =
      doc(
        db,
        "bills",
        docId
      );

    // Resolve chain members from cache before entering the transaction.
    // Ancestor bills (effectiveVersion:false) are immutable — safe to read from cache.
    const chainIds =
      getBillChainIds(docId);

    const chainToLock =
      chainIds.filter(
        id => id !== docId
      );

    try {
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

          // Remove freed serial from active and return it to the reusable pool.
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

          let reusable = [
            ...new Set(
              serialData[
                keys.reusableKey
              ] || []
            )
          ];

          reusable.push(
            bill.serialNumber
          );

          transaction.update(
            serialDocRef,
            {
              [keys.activeKey]:
                active,
              [keys.reusableKey]:
                reusable
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
              mode:
                bill.mode || "W",
              createdAt:
                serverTimestamp()
            }
          );

          transaction.delete(
            billRef
          );

          // Lock ancestor revision chain atomically.
          // If locking fails, the entire transaction rolls back — no partial success.
          chainToLock.forEach(id => {
            transaction.update(
              doc(db, "bills", id),
              { isLocked: true }
            );
          });
        }
      );
    } catch (err) {
      console.error(err);

      alert(
        "Failed to complete bill: " +
          err.message
      );
    } finally {
      isReceiverBusy =
        false;
    }
  };
