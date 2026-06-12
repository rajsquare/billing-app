import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  onSnapshot,
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  query,
  orderBy,
  where,
  limit,
  Timestamp,
  runTransaction,
  getDocs,
  getDoc,
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

/* ================================
   PRICE LIST FIREBASE
================================ */
const pricelistFirebaseConfig = {
  apiKey: "AIzaSyBnOfAnNnBybahK1PPjxeZi_9ek8lh1lJY",
  authDomain: "pricelist-a9d70.firebaseapp.com",
  projectId: "pricelist-a9d70",
  storageBucket: "pricelist-a9d70.firebasestorage.app",
  messagingSenderId: "829966591460",
  appId: "1:829966591460:web:c1a8dc9c0d6af76c1e13f1"
};

const pricelistApp = initializeApp(
  pricelistFirebaseConfig,
  "pricelist"
);

const pricelistDb =
  getFirestore(pricelistApp);
const billsCollection = collection(db, "bills");
const daybookCollection = collection(db, "daybook");
const liveDraftBillsCollection = collection(db, "liveDraftBills");

/* ================================
   INTL FORMATTERS (module-level, reused across all renders)
================================ */
const _moneyFmt = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
const _moneyWholeFmt = new Intl.NumberFormat("en-IN");
const _dateFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  year: "numeric"
});
const _timeFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true
});
const _todayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

const billsQuery = query(
  billsCollection,
  where("createdAt", ">=", getStartOfTodayTimestamp()),
  orderBy("createdAt", "asc"),
  limit(200)
);

const daybookQuery = query(
  daybookCollection,
  where("createdAt", ">=", getStartOfTodayTimestamp()),
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

let _saveDraftTimer = null;
let _searchTimer = null;
let _syncDraftTimer = null;
let _lastDraftHash = "";
let _lastStaleCleanup = 0;
let productsBySr = new Map();

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
const filterChips =
  materialFilterDiv.querySelectorAll(".filter-chip");

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

/* Cached refs used inside frequently-called functions */
const billItemCountEl =
  document.getElementById("billItemCount");
const revisionBanner =
  document.getElementById("revisionBanner");
const modalTitle =
  printModal.querySelector(".modal-title");
const modalBillSummary =
  document.getElementById("modalBillSummary");

/* ================================
   TOAST
================================ */
function showToast(message, type = "success") {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.classList.add("toast--visible");
    });
  });

  setTimeout(() => {
    toast.classList.remove("toast--visible");
    setTimeout(() => toast.remove(), 280);
  }, 2800);
}

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

const _escMap = { "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" };
function escapeAttr(value) {
  return String(value ?? "").replace(/[&"<>]/g, c => _escMap[c]);
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
  return {
    displayDate: _dateFmt.format(now),
    displayTime: _timeFmt.format(now)
  };
}

function getIndiaTodayDate() {
  return _todayFmt.format(new Date());
}

function getStartOfTodayTimestamp() {
  const now = new Date();

  const istDateStr = _todayFmt.format(now);

  const parts = istDateStr.split("-");
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);

  const midnightUTC = new Date(
    Date.UTC(year, month, day, 0, 0, 0, 0)
  );

  midnightUTC.setUTCMinutes(
    midnightUTC.getUTCMinutes() - 330
  );

  return Timestamp.fromDate(midnightUTC);
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
  return _moneyFmt.format(Number(value || 0));
}

function formatIndianMoneyWhole(value) {
  return _moneyWholeFmt.format(Math.round(Number(value) || 0));
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
  if (_saveDraftTimer) {
    clearTimeout(_saveDraftTimer);
    _saveDraftTimer = null;
  }
  localStorage.removeItem(
    BILL_DRAFT_KEY
  );
}

function debouncedSaveDraft() {
  if (_saveDraftTimer) clearTimeout(_saveDraftTimer);
  _saveDraftTimer = setTimeout(saveDraft, 300);
}

function saveDraftNow() {
  if (_saveDraftTimer) {
    clearTimeout(_saveDraftTimer);
    _saveDraftTimer = null;
  }
  saveDraft();
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

    const intentionalSwitch =
      sessionStorage.getItem("intentionalAppSwitch") === "true";

    sessionStorage.removeItem("intentionalAppSwitch");

    if (!intentionalSwitch) {
      const shouldRestore =
        confirm(
          "Resume unfinished bill?"
        );

      if (!shouldRestore) {
        clearDraft();
        return;
      }
    }

    const restoredItems =
      draft.billItems
        .map(savedItem => {
          const product =
            productsBySr.get(savedItem.productSr);

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
      billItemsDiv.querySelector(
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

function simpleDraftHash(items, name) {
  let str =
    (name || "") + "|";

  for (let i = 0; i < items.length; i++) {
    str +=
      items[i].product.productName +
      ":" +
      items[i].qty +
      ",";
  }

  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash =
      ((hash << 5) - hash) +
      str.charCodeAt(i);
    hash |= 0;
  }

  return String(hash);
}

function debouncedSyncLiveDraft() {
  if (_syncDraftTimer) {
    clearTimeout(_syncDraftTimer);
  }

  _syncDraftTimer = setTimeout(() => {
    _syncDraftTimer = null;

    const currentHash = simpleDraftHash(
      billItems,
      customerName.value
    );

    if (currentHash === _lastDraftHash) {
      return;
    }

    _lastDraftHash = currentHash;
    syncLiveDraft();
  }, 1000);
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

function countActiveDrafts() {
  let count = 0;
  const now = Date.now();
  for (const id in liveDraftsCache) {
    const draft = liveDraftsCache[id];
    if (!draft.updatedAt) { count++; continue; }
    const ms =
      typeof draft.updatedAt.toMillis === "function"
        ? draft.updatedAt.toMillis()
        : 0;
    if (now - ms <= 120000) count++;
  }
  return count;
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
    countActiveDrafts();

  if (liveBtn) {
    liveBtn.innerHTML = count > 0
      ? `LIVE <span class="live-count-badge">${count}</span>`
      : `LIVE`;

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
          <div class="live-draft-header">
            <div class="live-draft-name">
              ${escapeAttr(draft.customerName || "WALK-IN")}
            </div>
            <div class="live-draft-subtotal">
              ₹${formatIndianMoneyWhole(draft.subtotal)}
            </div>
          </div>
          <div class="live-draft-footer">
            <div class="live-draft-meta">
              <span>${draft.mode === "W" ? "W" : "R"}</span>
              <span>${draft.itemCount} item${draft.itemCount !== 1 ? "s" : ""}</span>
              ${draft.revisionLabel
                ? `<div class="live-revision-tag">${escapeAttr(draft.revisionLabel)}</div>`
                : ""}
            </div>
            <div class="live-draft-chevron">›</div>
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

      const now = Date.now();
      if (now - _lastStaleCleanup > 30000) {
        _lastStaleCleanup = now;

        Object.keys(liveDraftsCache).forEach(
          id => {
            if (
              id !== sessionId &&
              isDraftStale(liveDraftsCache[id])
            ) {
              deleteDoc(
                doc(db, "liveDraftBills", id)
              ).catch(() => {});
            }
          }
        );
      }

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
  if (!revisionBanner) return;

  if (!revisionMode) {
    revisionBanner.style.display = "none";
    return;
  }

  const sourceBill =
    incomingBillCache[revisionSourceBillId];

  const serialStr =
    sourceBill && sourceBill.serialNumber
      ? " · #" + sourceBill.serialNumber
      : "";

  revisionBanner.style.display = "flex";
  revisionBanner.innerHTML = `
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
  totalPages,
  showFirstBillMarker = true
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
          <td>${formatIndianMoneyWhole(item.price)}</td>
          <td>${formatIndianMoneyWhole(item.total)}</td>
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
          ? `<td class="print-cell-changed">${formatIndianMoneyWhole(item.price)}</td>`
          : `<td>${formatIndianMoneyWhole(item.price)}</td>`;

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
          <td>${formatIndianMoneyWhole(item.total)}</td>
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

  const wholesaleFooter =
    revisedBill.mode === "W" && isLastPage
      ? buildWholesaleBottomFooterHTML(
        revisedBill,
        "OFFICE COPY"
      )
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
    <div class="invoice-box-unit">
      <div class="print-estimate-heading">Estimate</div>
      <div class="print-wrapper receipt-copy" style="position:relative;">
        <div class="copy-label office-copy-label" style="background-color:#808080;color:#ffff00;display:block;width:100%;box-sizing:border-box;">OFFICE COPY</div>

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
            <span class="print-serial">${revisedBill.serialNumber ? (showFirstBillMarker && shouldShowOfficeFirstBillMarker(revisedBill, "OFFICE COPY") ? "① " : "") + "#" + escapeAttr(revisedBill.serialNumber) : ""}</span>
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

        <div class="print-total-area">
          <div class="print-total">
            Grand Total: ₹${formatIndianMoneyWhole(revisedBill.grandTotal)}/-
          </div>
          <div class="print-gst-notice">
            GST @ 5% applicable as per prevailing tax regulations.
          </div>

          ${revMeta}
        </div>

        ${wholesaleFooter}

        ${totalPages > 1
          ? `<div class="bill-page-watermark">Page ${pageNum}/${totalPages}</div>`
          : ""}
      </div>
    </div>
  `;
}

function measureAvailableRowsInRenderedPage(sandbox) {
  const wrapper =
    sandbox.querySelector(".print-wrapper");
  const table =
    sandbox.querySelector(".print-table");
  const totalArea =
    sandbox.querySelector(".print-total-area");
  const bottomFooter =
    sandbox.querySelector(".print-bottom-footer");

  const wrapperRect =
    wrapper.getBoundingClientRect();
  const tableRect =
    table.getBoundingClientRect();
  const totalRect =
    totalArea.getBoundingClientRect();
  const bottomFooterHeight =
    bottomFooter
      ? bottomFooter.getBoundingClientRect().height
      : 0;
  const wrapperStyles =
    window.getComputedStyle(wrapper);

  const contentBottom =
    wrapperRect.bottom -
    parseFloat(wrapperStyles.paddingBottom || 0);

  return Math.max(
    0,
      contentBottom -
      tableRect.bottom -
      Math.max(0, totalRect.height) -
      bottomFooterHeight -
      PRINT_HEIGHT_SAFETY_PX
  );
}

function paginateRevisionOfficeByHeight(
  mergedItems,
  revisedBill,
  originalBill,
  diff,
  showFirstBillMarker = true
) {
  if (!mergedItems.length) {
    return [{ chunk: [], serialOffset: 0 }];
  }

  const rowHeights = withMeasurementSandbox(
    buildRevisionOfficeSinglePage(
      revisedBill,
      originalBill,
      mergedItems,
      diff,
      false,
      1,
      1,
      showFirstBillMarker
    ),
    function(sandbox) {
      return Array.from(
        sandbox.querySelectorAll(".print-table tbody tr")
      ).map(function(row) {
        return row.getBoundingClientRect().height;
      });
    }
  );

  const standardBudget = withMeasurementSandbox(
    buildRevisionOfficeSinglePage(
      revisedBill,
      originalBill,
      [],
      diff,
      false,
      1,
      1,
      showFirstBillMarker
    ),
    measureAvailableRowsInRenderedPage
  );

  const lastPageBudget = withMeasurementSandbox(
    buildRevisionOfficeSinglePage(
      revisedBill,
      originalBill,
      [],
      diff,
      true,
      1,
      1,
      showFirstBillMarker
    ),
    measureAvailableRowsInRenderedPage
  );

  const rowBudget =
    Math.max(
      40,
      Math.min(standardBudget, lastPageBudget)
    );

  const pages = [];
  let currentChunk = [];
  let currentHeight = 0;
  let serialOffset = 0;

  mergedItems.forEach(function(item, index) {
    const rowHeight =
      rowHeights[index] || 18;

    if (
      currentChunk.length > 0 &&
      currentHeight + rowHeight > rowBudget
    ) {
      pages.push({
        chunk: currentChunk,
        serialOffset: serialOffset
      });
      serialOffset += currentChunk.length;
      currentChunk = [];
      currentHeight = 0;
    }

    currentChunk.push(item);
    currentHeight += rowHeight;
  });

  if (currentChunk.length > 0) {
    pages.push({
      chunk: currentChunk,
      serialOffset: serialOffset
    });
  }

  return pages;
}

function buildRevisionAuditPreviewHTML(
  revisedBill,
  originalBill,
  diff
) {
  const pages =
    paginateByHeight(
      [...revisedBill.items].reverse(),
      revisedBill,
      "OFFICE COPY"
    );

  const totalPages = pages.length;
  let html = "";

  pages.forEach((page, index) => {
    html += buildSingleCopyPage(
      revisedBill,
      "OFFICE COPY",
      page.chunk,
      index === totalPages - 1,
      index + 1,
      totalPages,
      page.serialOffset
    );
  });

  return html;
}

function buildRevisionReceiptPrintHTML(
  revisedBill,
  originalBill
) {
  const items =
    [...revisedBill.items].reverse();

  const customerPages =
    paginateByHeight(
      items,
      revisedBill,
      "CUSTOMER COPY"
    );

  const officePages =
    paginateByHeight(
      items,
      revisedBill,
      "OFFICE COPY"
    );

  let html = "";

  customerPages.forEach((page, index) => {
    html += buildSingleCopyPage(
      revisedBill,
      "CUSTOMER COPY",
      page.chunk,
      index === customerPages.length - 1,
      index + 1,
      customerPages.length,
      page.serialOffset
    );
  });

  officePages.forEach((page, index) => {
    html += buildSingleCopyPage(
      revisedBill,
      "OFFICE COPY",
      page.chunk,
      index === officePages.length - 1,
      index + 1,
      officePages.length,
      page.serialOffset
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
      const pages =
        paginateByHeight(
          [...bill.items].reverse(),
          bill,
          "VIEW"
        );
      let html = "";
      pages.forEach((page, index) => {
        html += buildSingleCopyPage(
          bill,
          "VIEW",
          page.chunk,
          index === pages.length - 1,
          index + 1,
          pages.length,
          page.serialOffset
        );
      });
      previewContent.innerHTML = html;
    } else {
      const pages =
        paginateByHeight(
          [...originalBill.items].reverse(),
          originalBill,
          "VIEW"
        );
      let html = "";
      pages.forEach((page, index) => {
        html += buildSingleCopyPage(
          originalBill,
          "VIEW",
          page.chunk,
          index === pages.length - 1,
          index + 1,
          pages.length,
          page.serialOffset
        );
      });
      previewContent.innerHTML = html;
    }
  } else {
    if (!originalBill) {
      const pages =
        paginateByHeight(
          [...bill.items].reverse(),
          bill,
          "VIEW"
        );
      let html = "";
      pages.forEach((page, index) => {
        html += buildSingleCopyPage(
          bill,
          "VIEW",
          page.chunk,
          index === pages.length - 1,
          index + 1,
          pages.length,
          page.serialOffset
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
async function loadProducts() {
  try {
    const todayStr = getIndiaTodayDate();
    const cacheRaw =
      localStorage.getItem("catalogCache");

    let catalogData = null;

    if (cacheRaw) {
      try {
        const cached = JSON.parse(cacheRaw);

        if (cached && cached.date === todayStr && cached.data) {
          catalogData = cached.data;
          console.log(
            "Using cached catalog from localStorage"
          );
        }
      } catch (e) {
        localStorage.removeItem("catalogCache");
      }
    }

    if (!catalogData) {
      const catalogRef = doc(
        pricelistDb,
        "catalog",
        "current"
      );
      const catalogSnap = await getDoc(catalogRef);

      if (!catalogSnap.exists()) {
        throw new Error("Catalog snapshot not found");
      }

      catalogData = catalogSnap.data();

      try {
        localStorage.setItem(
          "catalogCache",
          JSON.stringify({
            date: todayStr,
            data: catalogData
          })
        );
      } catch (e) {
        console.warn("Could not cache catalog to localStorage:", e);
      }

      console.log(
        "Fetched catalog from Firestore and cached"
      );
    }

    products = (catalogData.products || []).map(
      product => {
        const searchableText =
          normalize(
            `${product.productName} ${product.material || ""}`
          );

        return {
          ...product,
          searchableText,
          searchableTokens:
            tokenize(searchableText)
        };
      }
    );

    productsBySr.clear();

    products.forEach(
      p => productsBySr.set(p.sr, p)
    );

    restoreDraft();

  } catch (err) {
    console.error(err);
    showToast("Failed to load products", "error");
  }
}

loadProducts();

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
  ],
  "k+p": [
    "kalai"
  ],
  kalai: [
    "k+p"
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

let _levRow1 = new Int16Array(32);
let _levRow2 = new Int16Array(32);

function levenshtein(a, b) {
  if (a === b) return 0;
  const aLen = a.length;
  const bLen = b.length;
  if (Math.abs(aLen - bLen) > 2) return 3;

  if (aLen >= _levRow1.length) {
    _levRow1 = new Int16Array(aLen + 1);
    _levRow2 = new Int16Array(aLen + 1);
  }

  let prev = _levRow1;
  let curr = _levRow2;
  for (let j = 0; j <= aLen; j++) prev[j] = j;

  for (let i = 1; i <= bLen; i++) {
    curr[0] = i;
    const bi = b.charCodeAt(i - 1);
    for (let j = 1; j <= aLen; j++) {
      curr[j] = a.charCodeAt(j - 1) === bi
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], curr[j - 1], prev[j]);
    }
    const tmp = prev; prev = curr; curr = tmp;
  }

  return prev[aLen];
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

  if (queryToken.length <= 2) return 0;

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

function searchProducts(queryText) {
  const clean = normalize(queryText);
  if (!clean) return [];

  const queryTokens = expandQuery(clean);
  const scored = [];

  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    if (currentMaterialFilter && product.material !== currentMaterialFilter) continue;
    const score = scoreProduct(product, queryTokens, clean);
    if (score > 0) scored.push({ product, score });
  }

  scored.sort((a, b) => b.score - a.score);

  const out = [];
  const n = Math.min(scored.length, 8);
  for (let i = 0; i < n; i++) out.push(scored[i].product);
  return out;
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
  () => {
    activateView("receiver");
    renderIncomingBills();
  }
);

daybookTab.addEventListener(
  "click",
  () => {
    activateView(
      "daybook"
    );
    renderDaybook();
  }
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
    debouncedSaveDraft();
  }
);

customerName.addEventListener(
  "blur",
  saveDraftNow
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

    materialFilterDiv.style.display =
      value.trim()
        ? "flex"
        : "none";

    if (!value.trim()) {
      if (_searchTimer) {
        clearTimeout(_searchTimer);
        _searchTimer = null;
      }
      suggestions.innerHTML = "";
      return;
    }

    if (_searchTimer) clearTimeout(_searchTimer);
    _searchTimer = setTimeout(() => {
      renderSuggestions(searchProducts(value));
    }, 60);
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
    materialFilterDiv.style.display =
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

    filterChips.forEach(c => {
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
      const price = getCurrentPrice(product);
      html += `
        <div
          class="suggestion-card"
          onclick="selectProduct(${product.sr})"
        >
          <div class="suggestion-layout">
            <div class="suggestion-info">
              <div class="suggestion-name">
                ${escapeAttr(product.productName)}
              </div>
              <div class="badge-row">
                <div class="unit">
                  ${escapeAttr(product.priceType || "")}
                </div>
                ${
                  product.material
                    ? `<div class="unit ${getMaterialClass(product.material)}">${escapeAttr(product.material)}</div>`
                    : ""
                }
              </div>
            </div>
            <div class="suggestion-action-side">
              <div class="suggestion-price">
                ${price ? `₹${formatIndianMoneyWhole(price)}` : "—"}
              </div>
              <div class="suggestion-add-btn">+</div>
            </div>
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
    const product = productsBySr.get(sr);

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
    debouncedSyncLiveDraft();
    qtyDirty = false;

    searchBox.value = "";
    suggestions.innerHTML =
      "";
    clearSearch.style.display =
      "none";
    materialFilterDiv.style.display =
      "none";

    currentMaterialFilter = null;
    filterChips.forEach(c => {
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
  if (billItemCountEl) {
    billItemCountEl.textContent = billItems.length
      ? `${billItems.length} item${billItems.length !== 1 ? "s" : ""}`
      : "";
  }

  if (!billItems.length) {
    billItemsDiv.innerHTML = `
      <div class="empty-bill-state">
        <div class="empty-bill-hint">Search a product above to add it to the bill</div>
      </div>
    `;
    return;
  }

  let html = "";

  billItems.forEach(
    (
      item,
      index
    ) => {
      const isDiscount = isDiscountItem(item);
      const isEditable = isEditableNameItem(item);

      const safeQty =
        escapeAttr(item.qty);

      const safePrice =
        escapeAttr(item.price);

      const safeDisplayName =
        escapeAttr(item.displayName || item.product.productName);

      html += `
        <div class="bill-card">

          <div class="bill-card-top">
            <div class="bill-title">
              ${
                isEditable
                  ? `<input
                      class="bill-name-input"
                      type="text"
                      value="${safeDisplayName}"
                      placeholder="Product name"
                      oninput="updateDisplayName(${index}, this.value)"
                      onblur="commitDisplayName()"
                    >`
                  : safeDisplayName
              }
            </div>
            <button
              class="delete-btn"
              onclick="deleteItem(${index})"
            >✕</button>
          </div>

          <div class="badge-row">
            <div class="unit">
              ${item.product.priceType || ""}
            </div>
            ${
              item.product.material
                ? `<div class="unit ${getMaterialClass(item.product.material)}">${item.product.material}</div>`
                : ""
            }
          </div>

          <div class="input-labels-row">
            <span class="input-label">QTY</span>
            <span class="input-label">PRICE</span>
          </div>

          <div class="input-row">
            <input
              class="bill-input"
              type="text"
              inputmode="decimal"
              placeholder="0"
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
              placeholder="0"
              value="${safePrice}"
              oninput="updatePrice(${index}, this.value)"
              onblur="commitPrice()"
              onkeydown="if(event.key==='Enter'){commitPrice()}"
            >
          </div>

          ${
            isDiscount
              ? `<input
                  class="bill-input discount-note-input"
                  type="text"
                  placeholder="Note (optional)"
                  value="${escapeAttr(item.note || '')}"
                  oninput="updateNote(${index}, this.value)"
                  onblur="commitNote()"
                >`
              : ""
          }

          <div class="line-total-row">
            <div class="line-total${isDiscount ? ' line-total--discount' : ''}" data-line-total="${index}">
              ${isDiscount ? "−" : ""}₹${formatIndianMoney(Math.abs(item.total))}
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
    debouncedSaveDraft();
    qtyDirty = true;

    const totalEl =
      billItemsDiv.querySelector(
        `[data-line-total="${index}"]`
      );

    if (totalEl) {
      const item = billItems[index];
      totalEl.classList.toggle("line-total--discount", isDiscountItem(item));
      totalEl.innerText =
        `${isDiscountItem(item) ? "−" : ""}₹${formatIndianMoney(Math.abs(item.total))}`;
    }
  };

window.commitQty =
  function() {
    if (!qtyDirty) {
      return;
    }

    qtyDirty = false;
    debouncedSyncLiveDraft();
    saveDraftNow();
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
    debouncedSaveDraft();

    const totalEl =
      billItemsDiv.querySelector(
        `[data-line-total="${index}"]`
      );

    if (totalEl) {
      const item = billItems[index];
      totalEl.classList.toggle("line-total--discount", isDiscountItem(item));
      totalEl.innerText =
        `${isDiscountItem(item) ? "−" : ""}₹${formatIndianMoney(Math.abs(item.total))}`;
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
    debouncedSaveDraft();
  };

window.commitNote =
  function() { saveDraftNow(); };

window.updateDisplayName =
  function(index, value) {
    if (!billItems[index]) return;
    billItems[index].displayName = value;
    debouncedSaveDraft();
  };

window.commitDisplayName =
  function() { saveDraftNow(); };

window.commitPrice =
  function() { saveDraftNow(); };

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
    showToast("Add at least one item", "error");
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
    showToast("All items need a quantity", "error");
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
    showToast("All items need a price", "error");
    return false;
  }

  if (
    currentMode ===
      "W" &&
    !customerName.value.trim()
  ) {
    showToast("Enter customer name", "error");
    return false;
  }

  return true;
}
function openSendModal() {
  if (!billItems.length) {
    return;
  }

  if (modalTitle) {
    modalTitle.textContent =
      revisionMode
        ? "Send Revision"
        : "Send Details";
  }

  if (modalBillSummary) {
    const count = billItems.length;
    modalBillSummary.textContent =
      `${count} item${count !== 1 ? "s" : ""} · ${grandTotalEl.innerText}`;
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
            item.note || "",

          priceType:
            item.product.priceType || ""
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

            Object.assign(
              billData,
              getStoredFirstBillFlags(
                sourceData
              )
            );

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
        await createBillWithFirstBillFlags(
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

      showToast("Bill sent", "success");
    } catch (err) {
      console.error(err);

      showToast("Failed to send bill", "error");
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
      showToast("Bill is locked — cannot revise", "info");
      return;
    }

    const empInput =
      prompt(
        "Enter Employee ID"
      );

    if (empInput === null) return;

    if (!empInput.trim()) {
      showToast("Employee ID is required", "error");
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
    debouncedSyncLiveDraft();

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
    lastIssuedKey:
      mode +
      "LastIssued",
    firstBillOfDayKey:
      mode +
      "FirstBillOfDayDate"
  };
}

function getFirstBillFlagsForMode(
  mode,
  isFirstOfModeToday
) {
  return {
    isFirstWBillOfDay:
      mode === "W" &&
      isFirstOfModeToday,
    isFirstRBillOfDay:
      mode === "R" &&
      isFirstOfModeToday
  };
}

function getLegacyFirstBillFlags(
  bill
) {
  const mode =
    bill.mode || "W";

  const isLegacyFirst =
    bill.isFirstOfDay === true &&
    (
      !bill.firstOfDayMode ||
      bill.firstOfDayMode === mode
    );

  return getFirstBillFlagsForMode(
    mode,
    isLegacyFirst
  );
}

function getStoredFirstBillFlags(
  bill
) {
  const legacyFlags =
    getLegacyFirstBillFlags(
      bill
    );

  return {
    isFirstWBillOfDay:
      bill.isFirstWBillOfDay === true ||
      legacyFlags.isFirstWBillOfDay,
    isFirstRBillOfDay:
      bill.isFirstRBillOfDay === true ||
      legacyFlags.isFirstRBillOfDay
  };
}

function shouldShowOfficeFirstBillMarker(
  billData,
  label
) {
  if (
    label !== "OFFICE COPY"
  ) {
    return false;
  }

  const flags =
    getStoredFirstBillFlags(
      billData
    );

  return (
    billData.mode === "W" &&
    flags.isFirstWBillOfDay
  ) || (
    billData.mode === "R" &&
    flags.isFirstRBillOfDay
  );
}

async function createBillWithFirstBillFlags(
  billData
) {
  const billRef =
    doc(billsCollection);

  const todayDate =
    getIndiaTodayDate();

  await runTransaction(
    db,
    async transaction => {
      const keys =
        getModeKeys(
          billData.mode
        );

      const serialSnap =
        await transaction.get(
          serialDocRef
        );

      const serialData =
        serialSnap.exists()
          ? serialSnap.data()
          : {};

      const storedFirstBillDate =
        serialData[
          keys.firstBillOfDayKey
        ];

      const isFirstOfModeToday =
        !(
          typeof storedFirstBillDate === "string" &&
          storedFirstBillDate === todayDate
        );

      Object.assign(
        billData,
        getFirstBillFlagsForMode(
          billData.mode,
          isFirstOfModeToday
        )
      );

      transaction.set(
        billRef,
        billData
      );

      if (isFirstOfModeToday) {
        transaction.set(
          serialDocRef,
          {
            [keys.firstBillOfDayKey]:
              todayDate
          },
          { merge: true }
        );
      }
    }
  );

  return billRef;
}

/* ================================
   MEASURED PRINT PAGINATION

   The print engine paginates against the same
   DOM and CSS that are sent to the browser print
   renderer. Product rows are measured as rendered
   table rows, then packed into fixed-height page
   boxes with the real footer block reserved before
   each row is accepted.
================================ */

const PRINT_HEIGHT_SAFETY_PX = 10;

function withMeasurementSandbox(html, callback) {
  const sandbox = document.createElement("div");
  sandbox.className = "print-measurement-sandbox";
  sandbox.innerHTML = html;
  document.body.appendChild(sandbox);

  try {
    return callback(sandbox);
  } finally {
    document.body.removeChild(sandbox);
  }
}

function buildPrintRowHTML(item, serialNumber) {
  return `
    <tr>
      <td>${serialNumber}</td>
      <td>${escapeAttr(item.productName)}${item.note ? `<br><span class="print-item-note">${escapeAttr(item.note)}</span>` : ""}</td>
      <td>${shortMaterialName(item.material)}</td>
      <td>${roundQty(item.qty)}</td>
      <td>${formatIndianMoneyWhole(item.price)}</td>
      <td>${formatIndianMoneyWhole(item.total)}</td>
    </tr>
  `;
}

function buildWholesaleBottomFooterHTML(billData, label) {
  const isCustomerCopy =
    label === "CUSTOMER COPY";

  const customerFooterText =
    billData.grandTotal < 0
      ? "Return HV"
      : "Balance";

  return `
    <div class="print-bottom-footer">
      ${isCustomerCopy
        ? `<div class="print-balance print-balance-large">${customerFooterText}</div>`
        : `
          <div class="receiver-name-box-large">
            <div class="receiver-label-large">Receiver's Name:</div>
          </div>
        `}
    </div>
  `;
}

function buildTotalQuantityHTML(billData) {
  var totalKg = 0;
  var totalPcs = 0;
  (billData.items || []).forEach(function(item) {
    var qty = parseFloat(item.qty) || 0;
    if (item.priceType === "KG") {
      totalKg += qty;
    } else if (item.priceType === "PP") {
      totalPcs += qty;
    }
  });
  var parts = [];
  if (totalKg > 0) {
    parts.push(
      (Number.isInteger(totalKg) ? totalKg : parseFloat(totalKg.toFixed(3))) + " kg"
    );
  }
  if (totalPcs > 0) {
    parts.push(
      (Number.isInteger(totalPcs) ? totalPcs : parseFloat(totalPcs.toFixed(3))) + " pcs"
    );
  }
  if (parts.length === 0) return "";
  return `<div class="print-qty-summary">Total Quantity: ${parts.join(", ")}</div>`;
}

function buildPrintFooterHTML(billData, label, isLastPage) {
  const wholesaleFooter =
    billData.mode === "W" && isLastPage
      ? buildWholesaleBottomFooterHTML(
        billData,
        label
      )
      : "";

  const totalQtyHTML =
    label === "OFFICE COPY" && isLastPage
      ? buildTotalQuantityHTML(billData)
      : "";

  return `
    <div class="print-total-area">
      <div class="print-total">
        Grand Total: ₹${formatIndianMoneyWhole(billData.grandTotal)}/-
      </div>
      <div class="print-gst-notice">
        GST @ 5% applicable as per prevailing tax regulations.
      </div>
      ${totalQtyHTML}
    </div>
    ${wholesaleFooter}
  `;
}

function buildStandardPrintPageHTML(
  billData,
  label,
  rows,
  footerHTML,
  pageNum,
  totalPages
) {
  return `
    <div class="invoice-box-unit">
      <div class="print-estimate-heading">Estimate</div>
      <div class="print-wrapper receipt-copy">
        <div class="copy-label${label === 'OFFICE COPY' ? ' office-copy-label' : ''}" ${label === 'OFFICE COPY' ? 'style="background-color:#808080;color:#ffff00;display:block;width:100%;box-sizing:border-box;"' : ''}>${label}</div>

        <div class="print-header-row">
          ${billData.customerName && billData.customerName !== "Retail Bill"
            ? `<div class="print-customer">${escapeAttr(billData.customerName)}</div>`
            : ""}

          <div class="print-date-serial-row">
            <span class="print-date">${escapeAttr(billData.date)}</span>
            <span class="print-serial">${billData.serialNumber ? (shouldShowOfficeFirstBillMarker(billData, label) ? "① " : "") + "#" + escapeAttr(billData.serialNumber) : ""}</span>
          </div>

          ${label !== "CUSTOMER COPY" && billData.time
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

        ${footerHTML}

        ${totalPages > 1
          ? `<div class="bill-page-watermark">Page ${pageNum}/${totalPages}</div>`
          : ""}
      </div>
    </div>
  `;
}

function measureRenderedRows(items, billData, label) {
  const rows = items.map(function(item, index) {
    return buildPrintRowHTML(item, index + 1);
  }).join("");

  return withMeasurementSandbox(
    buildStandardPrintPageHTML(
      billData,
      label,
      rows,
      buildPrintFooterHTML(billData, label, false),
      1,
      1
    ),
    function(sandbox) {
      return Array.from(
        sandbox.querySelectorAll(".print-table tbody tr")
      ).map(function(row) {
        return row.getBoundingClientRect().height;
      });
    }
  );
}

function measurePageCapacity(billData, label, isLastPage) {
  return withMeasurementSandbox(
    buildStandardPrintPageHTML(
      billData,
      label,
      "",
      buildPrintFooterHTML(billData, label, isLastPage),
      1,
      1
    ),
    function(sandbox) {
      const wrapper =
        sandbox.querySelector(".print-wrapper");
      const table =
        sandbox.querySelector(".print-table");
      const totalArea =
        sandbox.querySelector(".print-total-area");
      const bottomFooter =
        sandbox.querySelector(".print-bottom-footer");

      const wrapperRect =
        wrapper.getBoundingClientRect();
      const totalRect =
        totalArea.getBoundingClientRect();
      const bottomFooterHeight =
        bottomFooter
          ? bottomFooter.getBoundingClientRect().height
          : 0;
      const wrapperStyles =
        window.getComputedStyle(wrapper);

      const contentBottom =
        wrapperRect.bottom -
        parseFloat(wrapperStyles.paddingBottom || 0);

      const reservedFooterHeight =
        Math.max(0, totalRect.height) +
        bottomFooterHeight;

      const tableBottomWithoutRows =
        table.getBoundingClientRect().bottom;

      return Math.max(
        0,
        contentBottom -
          tableBottomWithoutRows -
          reservedFooterHeight -
          PRINT_HEIGHT_SAFETY_PX
      );
    }
  );
}

/*
 * paginateByHeight(items, billData, label)
 *
 * Returns an array of pages, each being:
 *   { chunk: Item[], serialOffset: number }
 *
 * serialOffset = count of items on previous pages,
 * used so row serial numbers are correct (1-based
 * within the whole bill, not just the page).
 */
function paginateByHeight(items, billData, label) {
  if (!items.length) return [{ chunk: [], serialOffset: 0 }];

  const rowHeights =
    measureRenderedRows(items, billData, label);
  const standardBudget =
    measurePageCapacity(billData, label, false);
  const lastPageBudget =
    measurePageCapacity(billData, label, true);
  const rowBudget =
    Math.max(
      40,
      Math.min(standardBudget, lastPageBudget)
    );

  const pages = [];
  let currentChunk = [];
  let currentHeight = 0;
  let serialOffset = 0;

  items.forEach(function(item, idx) {
    const rh = rowHeights[idx] || 18;

    if (currentChunk.length > 0 && currentHeight + rh > rowBudget) {
      pages.push({ chunk: currentChunk, serialOffset: serialOffset });
      serialOffset += currentChunk.length;
      currentChunk = [];
      currentHeight = 0;
    }

    currentChunk.push(item);
    currentHeight += rh;
  });

  if (currentChunk.length > 0) {
    pages.push({ chunk: currentChunk, serialOffset: serialOffset });
  }

  return pages;
}

function nextSerial(
  lastIssued
) {
  return (lastIssued % 100) + 1;
}

function buildSingleCopyPage(
  billData,
  label,
  itemsChunk,
  isLastPage,
  pageNum,
  totalPages,
  serialOffset
) {
 const serialStart = serialOffset || 0;
  const rows = itemsChunk.map(
    (item, idx) =>
      buildPrintRowHTML(
        item,
        serialStart + idx + 1
      )
  ).join("");

  return buildStandardPrintPageHTML(
    billData,
    label,
    rows,
    buildPrintFooterHTML(
      billData,
      label,
      isLastPage
    ),
    pageNum,
    totalPages
  );
}

function buildReceiptPrintHTML(
  billData
) {
  const items = [...billData.items].reverse();

  const customerPages =
    paginateByHeight(
      items,
      billData,
      "CUSTOMER COPY"
    );

  const officePages =
    paginateByHeight(
      items,
      billData,
      "OFFICE COPY"
    );

  let html = "";

  customerPages.forEach(
    (
      page,
      index
    ) => {
      html +=
        buildSingleCopyPage(
          billData,
          "CUSTOMER COPY",
          page.chunk,
          index === customerPages.length - 1,
          index + 1,
          customerPages.length,
          page.serialOffset
        );
    }
  );

  officePages.forEach(
    (
      page,
      index
    ) => {
      html +=
        buildSingleCopyPage(
          billData,
          "OFFICE COPY",
          page.chunk,
          index === officePages.length - 1,
          index + 1,
          officePages.length,
          page.serialOffset
        );
    }
  );

  return html;
}

function previewReceipt(
  billData
) {
  const pages =
    paginateByHeight(
      [...billData.items].reverse(),
      billData,
      "VIEW"
    );

  let html = "";

  pages.forEach(
    (
      page,
      index
    ) => {
      html +=
       buildSingleCopyPage(
  billData,
  "VIEW",
  page.chunk,
  index === pages.length - 1,
  index + 1,
  pages.length,
  page.serialOffset
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
    Object.keys(incomingBillCache)
    .filter(id => incomingBillCache[id].effectiveVersion !== false)
    .reverse();

  /* Badge always updates regardless of which view is active */
  let pendingCount = 0;
  for (const id of ids) {
    if (incomingBillCache[id].status === "pending") pendingCount++;
  }
  receiverTab.dataset.badge = pendingCount > 0 ? String(pendingCount) : "";

  /* DOM rebuild only when receiver view is visible */
  if (receiverView.style.display === "none") return;

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
        <div class="receiver-card-header">
          <div class="receiver-card-info">
            <div class="bill-title">
              ${escapeAttr(bill.customerName)}
            </div>
            <div class="badge-row">
              <div class="unit ${bill.status === 'pending' ? 'status-pending' : 'status-printed'}">
                ${bill.status === 'pending' ? 'Pending' : 'Printed'}
              </div>
              ${
                bill.serialNumber
                  ? `<div class="unit">#${escapeAttr(bill.serialNumber)}</div>`
                  : ""
              }
              <div class="unit">${escapeAttr(bill.mode)}</div>
              <div class="unit">${escapeAttr(bill.date)}</div>
            </div>
          </div>
          <div class="receiver-amount">
            ₹${formatIndianMoneyWhole(bill.grandTotal)}
          </div>
        </div>

        <div class="action-buttons">
          ${buttons}
        </div>
      </div>
    `;
  });

  incomingBills.innerHTML = html;
}

function renderDaybook() {
  if (
    daybookView.style.display === "none"
  ) {
    return;
  }

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

  const { wEntries, rEntries, wTotal, rTotal } =
    entries.reduce(
      (acc, e) => {
        if ((e.mode || "W") === "W") {
          acc.wEntries.push(e);
          acc.wTotal += e.amount;
        } else {
          acc.rEntries.push(e);
          acc.rTotal += e.amount;
        }
        return acc;
      },
      { wEntries: [], rEntries: [], wTotal: 0, rTotal: 0 }
    );

  const total = wTotal + rTotal;

  const breakdown = [
    wTotal > 0 ? `W: ₹${formatIndianMoneyWhole(wTotal)}` : "",
    rTotal > 0 ? `R: ₹${formatIndianMoneyWhole(rTotal)}` : ""
  ].filter(Boolean).join(" · ");

  daybookSummary.innerHTML = `
    <div class="daybook-total-amount">₹${formatIndianMoneyWhole(total)}</div>
    ${breakdown ? `<div class="daybook-total-breakdown">${breakdown}</div>` : ""}
  `;

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

  function entryCard(entry, mode = "") {
    return `
      <div class="daybook-entry${mode ? " daybook-entry--" + mode : ""}">
        <div class="daybook-entry-row">
          <div class="daybook-name">
            ${escapeAttr(entry.customerName)}
          </div>
          <div class="daybook-amount">
            ₹${formatIndianMoneyWhole(entry.amount)}
          </div>
        </div>
        <div class="daybook-date">
          #${escapeAttr(entry.serialNumber)} · ${escapeAttr(entry.date)}
        </div>
      </div>
    `;
  }

  let html = "";

  if (wEntries.length) {
    html +=
      `<div class="daybook-group-label">W Bills</div>`;

    wEntries.forEach(
      entry => { html += entryCard(entry, "w"); }
    );

    html +=
      `<div class="daybook-subtotal">W Total: ₹${formatIndianMoneyWhole(wTotal)}</div>`;
  }

  if (rEntries.length) {
    html +=
      `<div class="daybook-group-label">R Bills</div>`;

    rEntries.forEach(
      entry => { html += entryCard(entry, "r"); }
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

      showToast("Failed to delete daybook", "error");
    } finally {
      isDaybookBusy =
        false;
    }
  };

/* ================================
   APP SWITCHER
================================ */
document.getElementById("appTitleLink").addEventListener("click", (e) => {
  e.preventDefault();
  saveDraftNow();
  sessionStorage.setItem("intentionalAppSwitch", "true");
  localStorage.setItem("lastApp", "pricelist");
  window.location.href = "https://rajsquare.github.io/pricelist/";
});

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

            const lastIssuedSerial =
              serialData[keys.lastIssuedKey] !== undefined
                ? serialData[keys.lastIssuedKey]
                : (serialData[bill.mode] || 0);

            const isTestBill =
              (bill.customerName || "")
                .trim()
                .toLowerCase() === "test";

            const serial =
              isTestBill
                ? "TEST"
                : nextSerial(lastIssuedSerial);

            if (!isTestBill) {
              const updates = {
                [keys.lastIssuedKey]:
                  serial
              };

              transaction.update(
                serialDocRef,
                updates
              );
            }

            const billUpdate = {
              status:
                "printed",
              serialNumber:
                serial
            };

            transaction.update(
              billRef,
              billUpdate
            );

            return {
              ...bill,
              ...billUpdate
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

      showToast("Failed to print", "error");
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

      showToast("Failed to complete bill", "error");
    } finally {
      isReceiverBusy =
        false;
    }
  };
