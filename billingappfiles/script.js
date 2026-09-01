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
  writeBatch,
  increment,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import bcrypt from "https://cdn.jsdelivr.net/npm/bcryptjs@2.4.3/+esm";

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
const inventorySalesCollection = collection(db, "inventorySales");
const inventoryAccountingCollection = collection(db, "inventoryAccounting");

/* View casting uses a single, dedicated document as a lightweight handoff
   signal between Billing and the View (wall display) screen — the same
   pattern already used by updateSignalRef below for the pricelist-update
   signal. It is NOT the liveDraftBills collection: View only ever attaches
   to this one document (cheap, rare writes) and, only while a cast is
   active, to the one specific liveDraftBills document being cast. */
const viewCastRef = doc(db, "viewCast", "state");

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

const updateSignalRef = doc(
  db,
  "appConfig",
  "updateSignal"
);

/* ================================
   CONSTANTS
================================ */
const ADMIN_PASSWORD = "1110";
const INVENTORY_PASSWORD_HASH =
  "$2a$12$UO6q.7CCCVEKHx5nnv3YQ.zmnzHH1EVzq/UNs9OoK2F.hnItQBkDy";
const BILL_DRAFT_KEY = "billingAppDraftV4";
const DAYBOOK_PRINTED_KEY = "daybookPrintedOnce";
const LAST_PROCESSED_SIGNAL_KEY = "lastProcessedSignal";
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
let inventorySalesCache = {};

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

/* ---- VIEW / CAST STATE ----
   viewCast/state now holds an ARRAY of up to MAX_ACTIVE_CASTS casts:
     { casts: [ { sessionId, draftId, displayPrice }, ... ] }
   normalizeCasts() below also accepts the legacy single-cast schema
   ({ sessionId, startedAt }) so an already-active old cast is not
   broken by this deploy. All new writes use only the array schema. */
const MAX_ACTIVE_CASTS = 4;
let myCastActive = false;
let myCastDisplayPrice = false;
let viewCastControlUnsub = null;
let viewActiveCasts = [];
let viewDraftUnsubs = {};
let viewDraftCache = {};
let viewDraftItemCounts = {};
// Tracks the qty of each session's current (items[0]) item so the View
// panel can play its brief "new/updated weight" blink only when that
// value actually changes — never on unrelated re-renders. Local-only,
// never written to Firestore.
let viewDraftCurrentQty = {};

/* --- Product photo lookup (current-item photo AND history thumbnails
   share this exact mechanism — no separate loading path for either) ---
   productSr -> Cloudinary imageUrl, resolved from the existing
   pricelistDb.productImages collection (never written to, read-only).
   Keyed by String(sr) so lookups are stable regardless of whether the
   sr arrives as a number (from a live draft item) or a string (e.g.
   from a DOM dataset attribute in the error handler below). A cached
   value of `null` means "looked up, no image available" — that result
   is cached too, so a product with no photo is not re-queried on
   every render. Shared across all cast panels AND across the
   current/history split within a single panel, so a product appearing
   as the current item and again later in that same bill's history
   (or the same serial across multiple simultaneous casts) is only
   ever looked up once. The optional Daybook "Prepare View Display"
   workflow warms a persistent Cache API layer underneath this same
   in-memory map, without changing normal startup behavior. */
const productImageCache = new Map();
const productImagePending = new Set();
const PRODUCT_IMAGE_CACHE_NAME = "billing-view-product-images-v1";
const PRODUCT_IMAGE_CACHE_META_KEY = "billingViewProductImageCacheMetaV1";
const PRODUCT_IMAGE_MANIFEST_REFS = [
  ["productImageManifests", "current"],
  ["appConfig", "productImageManifest"]
];
const PRODUCT_IMAGE_PREPARE_CONCURRENCY = 6;
let productImageCacheMeta = readProductImageCacheMeta();
let productImagePrepareJob = null;
let productImageBlobUrls = new Map();

const VIEW_IMAGE_PLACEHOLDER_SVG =
  `<svg viewBox="0 0 24 24" class="view-product-image-icon" fill="none" ` +
  `stroke="currentColor" stroke-width="1.5" stroke-linecap="round" ` +
  `stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2">` +
  `</rect><circle cx="9" cy="10" r="1.5"></circle>` +
  `<path d="M21 16l-5.5-5.5a2 2 0 0 0-2.8 0L5 18"></path></svg>`;

function readProductImageCacheMeta() {
  try {
    const raw = localStorage.getItem(PRODUCT_IMAGE_CACHE_META_KEY);
    const parsed = raw ? JSON.parse(raw) : null;

    return parsed && parsed.images && typeof parsed.images === "object"
      ? parsed
      : { version: "", updatedAt: "", images: {}, failures: {} };
  } catch (err) {
    localStorage.removeItem(PRODUCT_IMAGE_CACHE_META_KEY);
    return { version: "", updatedAt: "", images: {}, failures: {} };
  }
}

function writeProductImageCacheMeta() {
  try {
    localStorage.setItem(
      PRODUCT_IMAGE_CACHE_META_KEY,
      JSON.stringify(productImageCacheMeta)
    );
  } catch (err) {
    console.warn("Could not persist product image cache metadata:", err);
  }
}

function normalizeProductImageManifest(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const rawImages = data.images || data.productImages || data.imageMap || {};
  const images = {};

  Object.entries(rawImages).forEach(([sr, url]) => {
    if (sr !== "" && typeof url === "string" && url.trim()) {
      images[String(sr)] = url.trim();
    }
  });

  return {
    version:
      data.version ||
      data.revision ||
      data.updatedAt?.toMillis?.() ||
      "",
    updatedAt:
      data.updatedAt?.toMillis?.() ||
      data.updatedAt ||
      "",
    images
  };
}

async function fetchProductImageManifest() {
  for (const [collectionName, docId] of PRODUCT_IMAGE_MANIFEST_REFS) {
    let snap = null;

    try {
      snap = await getDoc(doc(pricelistDb, collectionName, docId));
    } catch (err) {
      console.warn("Product image manifest read failed:", collectionName, docId, err);
      continue;
    }

    if (snap.exists()) {
      const manifest = normalizeProductImageManifest(snap.data());

      if (manifest && Object.keys(manifest.images).length) {
        return manifest;
      }
    }
  }

  return buildProductImageManifestFromExistingImages();
}

async function fetchLatestProductImageUrlForSr(sr) {
  const snap = await getDocs(
    query(
      collection(pricelistDb, "productImages"),
      where("sr", "==", sr)
    )
  );

  let best = null;

  snap.forEach(docSnap => {
    const data = docSnap.data();

    if (!data || !data.imageUrl) {
      return;
    }

    if (!best) {
      best = data;
      return;
    }

    const bestTime =
      best.createdAt && best.createdAt.toMillis
        ? best.createdAt.toMillis()
        : 0;
    const dataTime =
      data.createdAt && data.createdAt.toMillis
        ? data.createdAt.toMillis()
        : 0;

    if (dataTime > bestTime) {
      best = data;
    }
  });

  return best ? best.imageUrl : "";
}

async function buildProductImageManifestFromKnownProducts() {
  if (!products.length) {
    await loadProducts();
  }

  const productSrs = products
    .map(product => product && product.sr)
    .filter(sr => sr !== undefined && sr !== null && sr !== "");
  const images = {};

  await runWithConcurrency(
    productSrs,
    PRODUCT_IMAGE_PREPARE_CONCURRENCY,
    async sr => {
      try {
        const url = await fetchLatestProductImageUrlForSr(sr);

        if (url) {
          images[String(sr)] = url;
        }
      } catch (err) {
        console.warn("Product image lookup failed while building local manifest for sr", sr, err);
      }
    }
  );

  if (!Object.keys(images).length) {
    throw new Error("No product images are available to prepare, or image reads are not permitted.");
  }

  const version = String(Date.now());

  return {
    version,
    updatedAt: version,
    images
  };
}

async function buildProductImageManifestFromExistingImages() {
  let snap = null;

  try {
    snap = await getDocs(collection(pricelistDb, "productImages"));
  } catch (err) {
    console.warn("Product image collection scan failed; falling back to per-product lookups:", err);
    return buildProductImageManifestFromKnownProducts();
  }

  const bestBySr = new Map();

  snap.forEach(docSnap => {
    const data = docSnap.data();

    if (!data || data.sr === undefined || data.sr === null || !data.imageUrl) {
      return;
    }

    const key = String(data.sr);
    const existing = bestBySr.get(key);
    const existingTime =
      existing && existing.createdAt && existing.createdAt.toMillis
        ? existing.createdAt.toMillis()
        : 0;
    const dataTime =
      data.createdAt && data.createdAt.toMillis
        ? data.createdAt.toMillis()
        : 0;

    if (!existing || dataTime >= existingTime) {
      bestBySr.set(key, data);
    }
  });

  const images = {};

  bestBySr.forEach((data, sr) => {
    images[sr] = data.imageUrl;
  });

  if (!Object.keys(images).length) {
    throw new Error("No product images are available to prepare.");
  }

  const version = String(Date.now());

  return {
    version,
    updatedAt: version,
    images
  };
}

async function getProductImageCache() {
  if (!("caches" in window)) {
    return null;
  }

  return caches.open(PRODUCT_IMAGE_CACHE_NAME);
}

async function getCachedProductImageUrl(sr) {
  const key = String(sr);
  const meta = productImageCacheMeta.images[key];

  if (!meta || !meta.url) {
    return null;
  }

  if (productImageBlobUrls.has(key)) {
    return productImageBlobUrls.get(key);
  }

  try {
    const cache = await getProductImageCache();

    if (!cache) {
      return null;
    }

    const response = await cache.match(meta.url);

    if (!response || !response.ok) {
      return null;
    }

    const blobUrl = URL.createObjectURL(await response.blob());
    productImageBlobUrls.set(key, blobUrl);
    return blobUrl;
  } catch (err) {
    console.warn("Failed to read cached product image for sr", sr, err);
    return null;
  }
}

async function cacheProductImage(sr, url) {
  const key = String(sr);
  const cache = await getProductImageCache();

  if (!cache) {
    throw new Error("Browser Cache API is unavailable");
  }

  const response = await fetch(url, {
    mode: "cors",
    cache: "reload"
  });

  if (!response.ok) {
    throw new Error(`Image request failed with ${response.status}`);
  }

  await cache.put(url, response.clone());

  const oldBlobUrl = productImageBlobUrls.get(key);
  if (oldBlobUrl) {
    URL.revokeObjectURL(oldBlobUrl);
    productImageBlobUrls.delete(key);
  }

  productImageCacheMeta.images[key] = {
    url,
    cachedAt: Date.now()
  };

  if (productImageCacheMeta.failures) {
    delete productImageCacheMeta.failures[key];
  }

  productImageCache.set(key, await getCachedProductImageUrl(key));
}

async function cacheProductImageFromResolvedUrl(sr, url) {
  if (!url) {
    return;
  }

  try {
    await cacheProductImage(sr, url);
    writeProductImageCacheMeta();
  } catch (err) {
    console.warn("Failed to persist resolved product image for sr", sr, err);
  }
}

function updatePrepareViewStatus(state) {
  const statusEl = document.getElementById("prepareViewDisplayStatus");
  const btn = document.getElementById("prepareViewDisplayBtn");

  if (!statusEl || !btn) {
    return;
  }

  if (!state || state.status === "idle") {
    statusEl.innerHTML = "";
    btn.classList.remove("prepare-view-display-btn--active");
    btn.removeAttribute("aria-busy");
    return;
  }

  btn.classList.toggle("prepare-view-display-btn--active", state.status === "running");
  btn.setAttribute("aria-busy", state.status === "running" ? "true" : "false");

  const total = state.total || 0;
  const done = state.done || 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const message =
    state.message ||
    (state.status === "running"
      ? `Preparing View Display · ${done} / ${total}`
      : state.status === "done"
        ? `View ready · ${state.cached || 0} images cached${state.failed ? ` · ${state.failed} unavailable` : ""}`
        : `View preparation unavailable`);

  statusEl.innerHTML = `
    <div class="prepare-view-display-message">${escapeAttr(message)}</div>
    ${state.status === "running"
      ? `<div class="prepare-view-display-track"><div class="prepare-view-display-fill" style="width:${pct}%"></div></div>`
      : ""}
  `;
}

function yieldToBrowser() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

async function runWithConcurrency(items, limitCount, worker) {
  let index = 0;

  async function runNext() {
    while (index < items.length) {
      const currentIndex = index++;
      await worker(items[currentIndex], currentIndex);
      if (currentIndex % 12 === 0) {
        await yieldToBrowser();
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(limitCount, items.length) },
      runNext
    )
  );
}

async function cleanupObsoleteProductImages(manifestImages) {
  const cache = await getProductImageCache();

  if (!cache) {
    return;
  }

  const currentUrls = new Set(Object.values(manifestImages));

  await Promise.all(
    Object.entries(productImageCacheMeta.images).map(async ([sr, meta]) => {
      if (manifestImages[sr] !== meta.url) {
        if (!currentUrls.has(meta.url)) {
          await cache.delete(meta.url);
        }
        delete productImageCacheMeta.images[sr];
        const blobUrl = productImageBlobUrls.get(sr);
        if (blobUrl) {
          URL.revokeObjectURL(blobUrl);
          productImageBlobUrls.delete(sr);
        }
        productImageCache.delete(sr);
      }
    })
  );
}

async function prepareViewDisplayImages() {
  if (productImagePrepareJob) {
    updatePrepareViewStatus(productImagePrepareJob.state);
    return productImagePrepareJob.promise;
  }

  const state = {
    status: "running",
    total: 0,
    done: 0,
    cached: 0,
    failed: 0
  };

  const promise = (async () => {
    try {
      state.message = "Preparing View Display · loading manifest";
      updatePrepareViewStatus(state);

      const manifest = await fetchProductImageManifest();
      const entries = Object.entries(manifest.images);
      const cache = await getProductImageCache();

      if (!cache) {
        throw new Error("Browser Cache API is unavailable");
      }

      await cleanupObsoleteProductImages(manifest.images);

      const toDownload = [];

      for (const [sr, url] of entries) {
        const meta = productImageCacheMeta.images[sr];
        const existing = meta && meta.url === url
          ? await cache.match(url)
          : null;

        if (existing && existing.ok) {
          state.cached += 1;
          productImageCache.set(sr, await getCachedProductImageUrl(sr));
        } else {
          toDownload.push({ sr, url });
        }

        if ((state.cached + toDownload.length) % 25 === 0) {
          await yieldToBrowser();
        }
      }

      state.total = entries.length;
      state.done = state.cached;
      state.message = "";
      updatePrepareViewStatus(state);

      const downloadedUrls = new Set();

      await runWithConcurrency(
        toDownload,
        PRODUCT_IMAGE_PREPARE_CONCURRENCY,
        async ({ sr, url }) => {
          try {
            if (!downloadedUrls.has(url)) {
              await cacheProductImage(sr, url);
              downloadedUrls.add(url);
            } else {
              productImageCacheMeta.images[sr] = {
                url,
                cachedAt: Date.now()
              };
              productImageCache.set(sr, await getCachedProductImageUrl(sr));
            }

            state.cached += 1;
          } catch (err) {
            state.failed += 1;
            productImageCacheMeta.failures = productImageCacheMeta.failures || {};
            productImageCacheMeta.failures[sr] = {
              url,
              failedAt: Date.now(),
              message: err.message || String(err)
            };
            console.warn("Product image preparation failed for sr", sr, err);
          } finally {
            state.done += 1;
            updatePrepareViewStatus(state);
          }
        }
      );

      productImageCacheMeta.version = manifest.version || "";
      productImageCacheMeta.updatedAt = manifest.updatedAt || "";
      productImageCacheMeta.preparedAt = Date.now();
      writeProductImageCacheMeta();

      state.status = "done";
      updatePrepareViewStatus(state);

      activateView("view");

      requestAnimationFrame(() => {
        if (viewView && !document.fullscreenElement) {
          viewView.requestFullscreen().catch(err => {
            console.warn("Fullscreen request was rejected:", err);
          });
        }
      });

      setTimeout(() => {
        if (!productImagePrepareJob) {
          updatePrepareViewStatus({ status: "idle" });
        }
      }, 6000);
    } catch (err) {
      console.error("View display preparation failed:", err);
      state.status = "error";
      state.message = err.message || "View preparation unavailable";
      updatePrepareViewStatus(state);
      showToast(state.message, "error");
    } finally {
      productImagePrepareJob = null;
    }
  })();

  productImagePrepareJob = { promise, state };
  return promise;
}

/* Fire-and-forget: resolves productSr -> imageUrl via a single
   `where("sr","==",sr)` query against the existing pricelistDb,
   decoupled from rendering (renderProductImageHTML only ever
   calls this when the sr isn't already cached or already in flight,
   so quantity/price edits on the same current item never trigger a
   repeat lookup). Re-renders the View once, only when the lookup
   actually completes, so the resolved photo can appear. */
function resolveProductImage(sr) {
  if (sr === undefined || sr === null || sr === "") {
    return;
  }

  const key = String(sr);

  if (productImageCache.has(key) || productImagePending.has(key)) {
    return;
  }

  productImagePending.add(key);

  (async () => {
    let resolvedUrl = null;

    try {
      const cachedUrl = await getCachedProductImageUrl(key);

      if (cachedUrl) {
        productImageCache.set(key, cachedUrl);
        productImagePending.delete(key);
        renderViewLivePanels();
        return;
      }

      const snap = await getDocs(
        query(
          collection(pricelistDb, "productImages"),
          where("sr", "==", sr)
        )
      );

      // Data model uses random document IDs with `sr` as a field, so
      // more than one document can exist for the same serial. If that
      // happens, prefer the most recently created valid entry
      // (createdAt); fall back to the first valid entry found if
      // createdAt is missing on all of them.
      let best = null;

      snap.forEach(docSnap => {
        const d = docSnap.data();

        if (!d || !d.imageUrl) {
          return;
        }

        if (!best) {
          best = d;
          return;
        }

        const bestTime =
          best.createdAt && best.createdAt.toMillis
            ? best.createdAt.toMillis()
            : 0;
        const dTime =
          d.createdAt && d.createdAt.toMillis
            ? d.createdAt.toMillis()
            : 0;

        if (dTime > bestTime) {
          best = d;
        }
      });

      resolvedUrl = best ? best.imageUrl : null;

      if (resolvedUrl) {
        await cacheProductImageFromResolvedUrl(key, resolvedUrl);
        resolvedUrl = productImageCache.get(key) || resolvedUrl;
      }
    } catch (err) {
      // Non-fatal: the current item still renders (name/material/
      // quantity), just with the neutral placeholder instead of a
      // photo. Cached as "no image" below so a persistent failure
      // (e.g. missing read permission) doesn't re-query on every
      // subsequent render.
      console.error("Product image lookup failed for sr", sr, err);
    }

    if (!productImageCache.has(key)) {
      productImageCache.set(key, resolvedUrl);
    }
    productImagePending.delete(key);
    renderViewLivePanels();
  })();
}

/* Shared by BOTH the current-item photo and history thumbnails — same
   cache, same pending set, same resolveProductImage(), same
   placeholder/broken-image handling. `extraClass` is purely a CSS size
   modifier (e.g. "view-product-image--thumb" for history); it never
   affects caching/resolution, so a product appearing as the current
   item and later in history is still only ever looked up once. */
function renderProductImageHTML(sr, extraClass) {
  const sizeClass = extraClass ? ` ${extraClass}` : "";

  if (sr === undefined || sr === null || sr === "") {
    // No serial on this item — either an image lookup genuinely found
    // nothing, or (backward compatibility) this is an older live
    // draft item written before productSr existed. Either way: a
    // clean placeholder, never a guess and never a broken layout.
    return `<div class="view-product-image view-product-image--placeholder${sizeClass}">${VIEW_IMAGE_PLACEHOLDER_SVG}</div>`;
  }

  const key = String(sr);

  if (productImageCache.has(key)) {
    const url = productImageCache.get(key);

    return url
      ? `<div class="view-product-image${sizeClass}"><img class="view-product-image-img" src="${escapeAttr(url)}" alt="" data-sr="${escapeAttr(key)}" onerror="handleProductImageError(this)"></div>`
      : `<div class="view-product-image view-product-image--placeholder${sizeClass}">${VIEW_IMAGE_PLACEHOLDER_SVG}</div>`;
  }

  // Not resolved yet: kick off the (cached/deduped) lookup and show a
  // brief skeleton in the meantime — the name/material/quantity below
  // render immediately regardless, so the operator is never blocked
  // on this.
  resolveProductImage(sr);
  return `<div class="view-product-image view-product-image--loading${sizeClass}"></div>`;
}

/* ---- VIEW SLIDESHOW STATE (local-only, no Firestore) ---- */
let viewSlideshowImages = [];
let viewSlideshowIndex = 0;
let viewSlideshowDurationSec = 10;
let viewSlideshowTimer = null;

/* ================================
   DOM
================================ */
const billingTab =
  document.getElementById("billingTab");
const receiverTab =
  document.getElementById("receiverTab");
const viewTab =
  document.getElementById("viewTab");
const daybookTab =
  document.getElementById("daybookTab");

const billingView =
  document.getElementById("billingView");
const receiverView =
  document.getElementById("receiverView");
const viewView =
  document.getElementById("viewView");
const daybookView =
  document.getElementById("daybookView");

/* ---- VIEW (wall display) elements ---- */
const castViewBtn =
  document.getElementById("castViewBtn");
const showPricesToggle =
  document.getElementById("showPricesToggle");
const viewSlideshowStage =
  document.getElementById("viewSlideshowStage");
const viewSlideshowEmpty =
  document.getElementById("viewSlideshowEmpty");
const viewSlideshowLayers =
  document.getElementById("viewSlideshowLayers");
const viewLiveStage =
  document.getElementById("viewLiveStage");
const viewFullscreenBtn =
  document.getElementById("viewFullscreenBtn");
const viewSettingsBtn =
  document.getElementById("viewSettingsBtn");
const viewSettingsModal =
  document.getElementById("viewSettingsModal");
const closeViewSettings =
  document.getElementById("closeViewSettings");
const viewAddPhotosBtn =
  document.getElementById("viewAddPhotosBtn");
const viewAddPhotosInput =
  document.getElementById("viewAddPhotosInput");
const viewImportPptBtn =
  document.getElementById("viewImportPptBtn");
const viewImportPptInput =
  document.getElementById("viewImportPptInput");
const viewSlideList =
  document.getElementById("viewSlideList");
const viewDurationInput =
  document.getElementById("viewDurationInput");
const viewSettingsSave =
  document.getElementById("viewSettingsSave");

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
const adminSignalBtn =
  document.getElementById("adminSignalBtn");
const updatePricelistModal =
  document.getElementById("updatePricelistModal");
const updatePricelistBtn =
  document.getElementById("updatePricelistBtn");

const daybookFooterDate =
  document.getElementById("daybookFooterDate");
const prepareViewDisplayBtn =
  document.getElementById("prepareViewDisplayBtn");

const inventoryPasswordModal =
  document.getElementById("inventoryPasswordModal");
const inventoryPasswordInput =
  document.getElementById("inventoryPasswordInput");
const inventoryPasswordContinue =
  document.getElementById("inventoryPasswordContinue");

const inventoryModal =
  document.getElementById("inventoryModal");
const inventoryCloseBtn =
  document.getElementById("inventoryCloseBtn");
const inventorySearchView =
  document.getElementById("inventorySearchView");
const inventorySearchBox =
  document.getElementById("inventorySearchBox");
const inventorySuggestions =
  document.getElementById("inventorySuggestions");
const inventoryClearSearch =
  document.getElementById("inventoryClearSearch");
const inventoryEditorView =
  document.getElementById("inventoryEditorView");
const inventoryProductName =
  document.getElementById("inventoryProductName");
const inventoryCodeInput =
  document.getElementById("inventoryCodeInput");
const inventorySaveBtn =
  document.getElementById("inventorySaveBtn");
const inventoryCancelBtn =
  document.getElementById("inventoryCancelBtn");
const inventoryStockModeBtn =
  document.getElementById("inventoryStockModeBtn");
const inventorySalesModeBtn =
  document.getElementById("inventorySalesModeBtn");
const inventoryOverviewTitle =
  document.getElementById("inventoryOverviewTitle");
const inventoryOverviewList =
  document.getElementById("inventoryOverviewList");
const inventoryResetSalesBtn =
  document.getElementById("inventoryResetSalesBtn");
const inventoryPrintSalesBtn =
  document.getElementById("inventoryPrintSalesBtn");
const inventoryStockEditorFields =
  document.getElementById("inventoryStockEditorFields");
const inventorySalesReadout =
  document.getElementById("inventorySalesReadout");

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

/*
 * Same output as tokenize(normalize(text)), but for callers that already
 * hold normalized text (normalize() is idempotent, so re-running it is a
 * guaranteed no-op) — skips the redundant regex/toLowerCase/trim pass.
 */
function tokenizeNormalized(normalizedText) {
  return normalizedText
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

/**
 * Opens the Done password modal and resolves with
 * { confirmed: true, bulkAll: boolean } or { confirmed: false }.
 * Resets checkbox state on every open.
 */
function showDonePasswordDialog() {
  return new Promise(resolve => {
    const modal    = document.getElementById("donePasswordModal");
    const input    = document.getElementById("donePasswordInput");
    const checkbox = document.getElementById("doneAllTodayCheckbox");
    const btnOk    = document.getElementById("donePasswordOk");
    const btnCancel = document.getElementById("donePasswordCancel");

    // Reset state
    input.value        = "";
    checkbox.checked   = false;
    btnOk.disabled     = false;
    modal.style.display = "flex";
    input.focus();

    function cleanup() {
      modal.style.display = "none";
      btnOk.removeEventListener("click", onOk);
      btnCancel.removeEventListener("click", onCancel);
      input.removeEventListener("keydown", onKeydown);
    }

    function onOk() {
      const entered = input.value;

      if (entered !== ADMIN_PASSWORD) {
        alert("Incorrect password.");
        input.value = "";
        input.focus();
        return;
      }

      const bulkAll = checkbox.checked;
      cleanup();
      resolve({ confirmed: true, bulkAll });
    }

    function onCancel() {
      cleanup();
      resolve({ confirmed: false });
    }

    function onKeydown(e) {
      if (e.key === "Enter") onOk();
      if (e.key === "Escape") onCancel();
    }

    btnOk.addEventListener("click", onOk);
    btnCancel.addEventListener("click", onCancel);
    input.addEventListener("keydown", onKeydown);
  });
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
      productSr:
        item.product.sr,
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
        item.total || 0,
      priceType:
        item.product.priceType || ""
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

    // This session's live draft is gone (bill cleared, cancelled, or
    // finalized) — any cast pointing at it is no longer meaningful.
    // Ending it here covers every place deleteLiveDraft() is already
    // called (finalize, empty bill, revision cancel, etc.) without
    // duplicating a termination hook at each call site.
    if (myCastActive) {
      await endViewCast();
    }
  } catch (err) {
    console.error(
      "Live draft delete failed:",
      err
    );
  }
}

/* ================================
   VIEW CASTING (Billing side)
   Billing writes to viewCastRef only when the operator explicitly
   presses "Cast to View" / "End Cast" / toggles Show Prices — a handful
   of writes per day, not per keystroke. The bill content itself is
   never duplicated here; View reads it straight from the existing
   liveDraftBills document. viewCastRef now holds an array of up to
   MAX_ACTIVE_CASTS casts, written/read via a Firestore transaction so
   the 4-cast ceiling holds under concurrent Billing sessions.
================================ */

/* Accepts either the new { casts: [...] } schema or the legacy
   single-cast { sessionId, startedAt } schema written by the previous
   version of this feature, so an already-active old cast survives this
   deploy. Every write from this point on uses only the new schema. */
function normalizeCasts(data) {
  if (!data) {
    return [];
  }
  if (Array.isArray(data.casts)) {
    return data.casts;
  }
  if (data.sessionId) {
    return [
      {
        sessionId: data.sessionId,
        draftId: data.sessionId,
        displayPrice: false
      }
    ];
  }
  return [];
}

function updateCastButtonUI() {
  if (!castViewBtn) {
    return;
  }

  castViewBtn.style.display =
    billItems.length ? "inline-flex" : "none";

  castViewBtn.textContent =
    myCastActive ? "End" : "Cast to View";

  castViewBtn.classList.toggle(
    "cast-view-btn-active",
    myCastActive
  );

  if (showPricesToggle) {
    showPricesToggle.style.display =
      myCastActive ? "inline-flex" : "none";

    // Compact ₹ + switch presentation — no "Show Prices: ON/OFF" text.
    // State is communicated visually (switch position/color) and via
    // aria-pressed/aria-label for accessibility; the click handler and
    // toggleShowPrices() behavior are untouched.
    showPricesToggle.innerHTML =
      `<span class="price-toggle-symbol">₹</span>` +
      `<span class="price-toggle-switch"><span class="price-toggle-knob"></span></span>`;

    showPricesToggle.setAttribute(
      "aria-label",
      myCastDisplayPrice ? "Show prices: on" : "Show prices: off"
    );

    showPricesToggle.classList.toggle(
      "show-prices-toggle-on",
      myCastDisplayPrice
    );

    showPricesToggle.setAttribute(
      "aria-pressed",
      myCastDisplayPrice ? "true" : "false"
    );
  }
}

/* One atomic attempt to add this session to the shared cast array.
   Returns { ok: true } on success (including the idempotent case where
   this session is already casting), or { ok: false, casts } if the
   array is already at MAX_ACTIVE_CASTS. */
async function attemptCastTransaction() {
  return runTransaction(db, async tx => {
    const snap = await tx.get(viewCastRef);
    const casts = normalizeCasts(snap.exists() ? snap.data() : null);

    if (casts.find(c => c.sessionId === sessionId)) {
      return { ok: true, casts };
    }

    if (casts.length >= MAX_ACTIVE_CASTS) {
      return { ok: false, casts };
    }

    const nextCasts = casts.concat([
      {
        sessionId,
        draftId: sessionId,
        displayPrice: false
      }
    ]);

    tx.set(viewCastRef, { casts: nextCasts });
    return { ok: true, casts: nextCasts };
  });
}

/* Removes exactly one cast entry by sessionId, atomically. Used both by
   Billing ending its own cast and by View self-healing a cast whose
   underlying draft has disappeared (see attachCastDraftListener). A
   no-op write is skipped so repeated calls are safe (idempotent). */
async function removeCastFromControlDoc(targetSessionId) {
  try {
    await runTransaction(db, async tx => {
      const snap = await tx.get(viewCastRef);
      if (!snap.exists()) {
        return;
      }
      const casts = normalizeCasts(snap.data());
      const filtered = casts.filter(c => c.sessionId !== targetSessionId);
      if (filtered.length === casts.length) {
        return;
      }
      tx.set(viewCastRef, { casts: filtered });
    });
  } catch (err) {
    console.error("Failed to remove cast:", err);
  }
}

async function startViewCast() {
  if (!billItems.length || myCastActive) {
    return;
  }

  castViewBtn.disabled = true;

  try {
    // Make sure View has fresh data the instant it attaches, rather than
    // waiting out the 1s debounce on the very first frame.
    if (_syncDraftTimer) {
      clearTimeout(_syncDraftTimer);
      _syncDraftTimer = null;
    }
    _lastDraftHash = simpleDraftHash(billItems, customerName.value);
    await syncLiveDraft();

    let result = await attemptCastTransaction();

    if (!result.ok) {
      // All 4 slots are taken. Before giving up, check whether any of
      // those casts is actually abandoned (its draft is gone or hasn't
      // been touched in 2+ minutes, reusing the existing isDraftStale
      // convention) and free that slot. This only runs in the rare
      // case the deck is already full — not a recurring cost.
      const staleIds = [];

      for (const c of result.casts) {
        const draftSnap = await getDoc(
          doc(db, "liveDraftBills", c.draftId || c.sessionId)
        );
        if (!draftSnap.exists() || isDraftStale(draftSnap.data())) {
          staleIds.push(c.sessionId);
        }
      }

      if (staleIds.length) {
        for (const id of staleIds) {
          await removeCastFromControlDoc(id);
        }
        result = await attemptCastTransaction();
      }
    }

    if (!result.ok) {
      showToast("View is already displaying 4 bills.", "error");
      return;
    }

    myCastActive = true;
    myCastDisplayPrice = false;
    updateCastButtonUI();
  } catch (err) {
    console.error("Failed to start cast:", err);
    showToast("Failed to start cast", "error");
  } finally {
    castViewBtn.disabled = false;
  }
}

async function endViewCast() {
  if (!myCastActive) {
    return;
  }

  myCastActive = false;
  myCastDisplayPrice = false;
  updateCastButtonUI();

  await removeCastFromControlDoc(sessionId);
}

/* Presentation-only: flips whether THIS session's cast shows monetary
   information on View. Never touches the bill/live draft. */
async function toggleShowPrices() {
  if (!myCastActive) {
    return;
  }

  const nextValue = !myCastDisplayPrice;

  try {
    await runTransaction(db, async tx => {
      const snap = await tx.get(viewCastRef);
      const casts = normalizeCasts(snap.exists() ? snap.data() : null);
      const idx = casts.findIndex(c => c.sessionId === sessionId);

      if (idx === -1) {
        // Our cast entry vanished (e.g. removed by stale cleanup) —
        // nothing to toggle.
        return;
      }

      casts[idx] = { ...casts[idx], displayPrice: nextValue };
      tx.set(viewCastRef, { casts });
    });

    myCastDisplayPrice = nextValue;
    updateCastButtonUI();
  } catch (err) {
    console.error("Failed to toggle Show Prices:", err);
    showToast("Failed to update Show Prices", "error");
  }
}

/* ================================
   VIEW SCREEN (wall display side)
================================ */

/* --- Local slideshow persistence (IndexedDB for images, localStorage
   for the small duration setting). No Firestore involved at all. --- */
const VIEW_IMAGES_DB_NAME = "viewSlideshowImages";
const VIEW_IMAGES_STORE_NAME = "images";
const VIEW_DURATION_KEY = "viewSlideshowDurationSec";

function openViewImagesDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(VIEW_IMAGES_DB_NAME, 1);

    req.onupgradeneeded = () => {
      const dbi = req.result;
      if (!dbi.objectStoreNames.contains(VIEW_IMAGES_STORE_NAME)) {
        dbi.createObjectStore(VIEW_IMAGES_STORE_NAME, { keyPath: "id" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function viewDbGetAllImages() {
  const dbi = await openViewImagesDb();
  return new Promise((resolve, reject) => {
    const tx = dbi.transaction(VIEW_IMAGES_STORE_NAME, "readonly");
    const req = tx.objectStore(VIEW_IMAGES_STORE_NAME).getAll();
    req.onsuccess = () =>
      resolve(req.result.sort((a, b) => a.order - b.order));
    req.onerror = () => reject(req.error);
  });
}

async function viewDbPutImage(record) {
  const dbi = await openViewImagesDb();
  return new Promise((resolve, reject) => {
    const tx = dbi.transaction(VIEW_IMAGES_STORE_NAME, "readwrite");
    tx.objectStore(VIEW_IMAGES_STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function viewDbDeleteImage(id) {
  const dbi = await openViewImagesDb();
  return new Promise((resolve, reject) => {
    const tx = dbi.transaction(VIEW_IMAGES_STORE_NAME, "readwrite");
    tx.objectStore(VIEW_IMAGES_STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function loadSlideshowDurationConfig() {
  const stored = Number(localStorage.getItem(VIEW_DURATION_KEY));
  viewSlideshowDurationSec = stored > 0 ? stored : 10;
}

/* --- Slideshow playback (purely local, no network activity) --- */
async function loadSlideshowImagesIntoMemory() {
  const records = await viewDbGetAllImages().catch(() => []);

  viewSlideshowImages.forEach(img => URL.revokeObjectURL(img.url));

  viewSlideshowImages = records.map(r => ({
    id: r.id,
    url: URL.createObjectURL(r.blob)
  }));

  if (viewSlideshowIndex >= viewSlideshowImages.length) {
    viewSlideshowIndex = 0;
  }

  renderSlideshowFrame();
}

function renderSlideshowFrame() {
  if (!viewSlideshowLayers || !viewSlideshowEmpty) {
    return;
  }

  if (!viewSlideshowImages.length) {
    viewSlideshowEmpty.style.display = "flex";
    viewSlideshowLayers.style.display = "none";
    return;
  }

  viewSlideshowEmpty.style.display = "none";
  viewSlideshowLayers.style.display = "block";

  const img = viewSlideshowImages[viewSlideshowIndex];
  viewSlideshowLayers.innerHTML =
    `<img src="${img.url}" class="view-slide-img" alt="">`;
}

function stopSlideshowTimer() {
  if (viewSlideshowTimer) {
    clearInterval(viewSlideshowTimer);
    viewSlideshowTimer = null;
  }
}

function startSlideshowTimer() {
  stopSlideshowTimer();

  if (viewSlideshowImages.length < 2) {
    return;
  }

  viewSlideshowTimer = setInterval(() => {
    viewSlideshowIndex =
      (viewSlideshowIndex + 1) % viewSlideshowImages.length;
    renderSlideshowFrame();
  }, viewSlideshowDurationSec * 1000);
}

function pauseSlideshow() {
  stopSlideshowTimer();
}

function resumeSlideshow() {
  renderSlideshowFrame();
  startSlideshowTimer();
}

function showSlideshowStage() {
  if (viewLiveStage) viewLiveStage.style.display = "none";
  if (viewSlideshowStage) viewSlideshowStage.style.display = "block";
  resumeSlideshow();
}

function showLiveStage() {
  pauseSlideshow();
  if (viewSlideshowStage) viewSlideshowStage.style.display = "none";
  if (viewLiveStage) viewLiveStage.style.display = "grid";
}

/* --- Live bill rendering (read-only, reuses the existing draft shape —
   no second bill/total calculation is implemented here). Renders one
   panel per active cast, N equal-width columns, driven entirely by
   viewActiveCasts.length. displayPrice is presentation-only: it never
   changes which fields exist on the underlying draft, only which of
   the already-computed fields this panel shows.

   Item ordering note: selectProduct() unshifts new items onto the
   FRONT of billItems (confirmed — it is the only insertion path), and
   buildDraftPayload() preserves that order into draft.items. So
   items[0] is always the most recently added item — that is "current"
   — and items.slice(1) is history, already newest-first. No existing
   selected/edited-item state exists elsewhere in Billing to reuse. --- */
function formatViewQty(qty) {
  // Display-only formatting: always exactly 2 decimal places. Never
  // touches the underlying stored/calculated qty value.
  return qty > 0 ? Number(qty).toFixed(2) : "—";
}

/* A resolved imageUrl that fails to actually load (e.g. the Cloudinary
   asset was moved/deleted after the Firestore doc was written) is
   treated the same as "no image" from then on, so later re-renders
   show the placeholder instead of retrying a known-broken URL. Fixes
   up the DOM immediately rather than waiting for the next snapshot.
   Attached to window because script.js is a module (inline
   onerror="" handlers run in global scope) — same pattern already
   used for window.selectProduct etc. */
window.handleProductImageError = function (imgEl) {
  const key = imgEl.dataset.sr;

  if (key) {
    productImageCache.set(key, null);
  }

  const container = imgEl.closest(".view-product-image");

  if (container) {
    container.classList.remove("view-product-image--loading");
    container.classList.add("view-product-image--placeholder");
    container.innerHTML = VIEW_IMAGE_PLACEHOLDER_SVG;
  } else {
    imgEl.remove();
  }
};

/* Display-only quantity metadata, derived purely from the existing
   item.priceType ("KG" or "PP", written at draft-save time — see
   buildDraftPayload) that already drives Total Quantity on the
   printed invoice (buildTotalQuantityHTML). Never introduces a new
   field: just a display label/unit pairing for an existing one. */
function getViewQtyMeta(item) {
  if (item && item.priceType === "KG") {
    return { label: "WEIGHT", unit: "kg" };
  }
  if (item && item.priceType === "PP") {
    return { label: "PIECES", unit: "pcs" };
  }
  return { label: "QUANTITY", unit: "" };
}

const VIEW_INFO_ICON_SVG =
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ` +
  `stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle>` +
  `<path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg>`;

const VIEW_CLOCK_ICON_SVG =
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ` +
  `stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle>` +
  `<path d="M12 7v5l3 3"></path></svg>`;

const VIEW_WEIGHT_ICON_SVG =
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" ` +
  `stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4"></path>` +
  `<path d="M7 7h10l2 13H5L7 7Z"></path><path d="M9 11a3 3 0 0 0 6 0"></path></svg>`;

const VIEW_PIECES_ICON_SVG =
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" ` +
  `stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5 9 5 9-5Z"></path>` +
  `<path d="M3 8v8l9 5 9-5V8"></path><path d="M12 13v8"></path></svg>`;

const VIEW_ITEMS_ICON_SVG =
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" ` +
  `stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10"></path>` +
  `<path d="M12 20V4"></path><path d="M20 20v-7"></path></svg>`;

function renderCurrentItemHTML(item, showPrices, blinkQty, index) {
  // Material is shown as a compact neutral badge, matching the
  // reference design's soft beige pill — the underlying material
  // value/data is untouched, this is purely a presentational wrapper.
  const materialText = (item.material || "").trim();
  const materialLine = materialText
    ? `<span class="view-material-badge">${escapeAttr(materialText)}</span>`
    : "";

  const qtyMeta = getViewQtyMeta(item);
  const qtyText = formatViewQty(item.qty);
  const qtyValueClass = blinkQty
    ? "view-current-qty-value view-current-qty-value--blink"
    : "view-current-qty-value";
  const unitHTML = qtyMeta.unit
    ? `<span class="view-current-qty-unit">${qtyMeta.unit}</span>`
    : "";
  const qtyBlock = `
    <div class="view-current-qty-block">
      <span class="view-current-qty-label">${qtyMeta.label}</span>
      <div class="${qtyValueClass}">${qtyText} ${unitHTML}</div>
    </div>
  `;

  let priceBlock = "";
  if (showPrices) {
    const rateText =
      item.price > 0 ? "₹" + formatIndianMoneyWhole(item.price) : "—";
    const amountText =
      item.qty > 0 && item.price > 0
        ? "₹" + formatIndianMoneyWhole(Math.abs(item.total))
        : "—";

    priceBlock = `
      <div class="view-current-price-block">
        <div class="view-current-price-row">
          <span class="view-current-price-label">Rate</span>
          <span class="view-current-price-value">${rateText}</span>
        </div>
        <div class="view-current-price-row">
          <span class="view-current-price-label">Amount</span>
          <span class="view-current-price-value">${amountText}</span>
        </div>
      </div>
    `;
  }

  return `
    <span class="view-item-index">${index}</span>
    ${renderProductImageHTML(item.productSr)}
    <div class="view-current-info">
      <span class="view-just-added">Just Added</span>
      <div class="view-current-name">${escapeAttr(item.productName)}</div>
      ${materialLine}
    </div>
    <div class="view-current-side">
      ${qtyBlock}
      ${priceBlock}
    </div>
  `;
}

function renderHistoryItemHTML(item, showPrices, index) {
  // As with the current item, material is a plain neutral badge in the
  // View — getMaterialClass() is intentionally not used here so no
  // colorful category badge is applied.
  const materialText = (item.material || "").trim();
  const qtyMeta = getViewQtyMeta(item);
  const qtyText = formatViewQty(item.qty);

  const materialHTML = materialText
    ? `<span class="view-material-badge">${escapeAttr(materialText)}</span>`
    : "";

  let moneyHTML = "";
  if (showPrices) {
    const rateText =
      item.price > 0 ? "₹" + formatIndianMoneyWhole(item.price) : "—";
    const amountText =
      item.qty > 0 && item.price > 0
        ? "₹" + formatIndianMoneyWhole(Math.abs(item.total))
        : "—";
    moneyHTML = `
      <div class="view-history-money-grid">
        <div class="view-history-money-block">
          <span class="view-history-money-label">Rate</span>
          <span class="view-history-money-value">${rateText}</span>
        </div>
        <div class="view-history-money-block">
          <span class="view-history-money-label">Amount</span>
          <span class="view-history-money-value">${amountText}</span>
        </div>
      </div>
    `;
  }

  const rowClass = showPrices
    ? "view-history-row view-history-row--priced"
    : "view-history-row";

  const unitHTML = qtyMeta.unit
    ? `<span class="view-history-qty-unit">${qtyMeta.unit}</span>`
    : "";

  return `
    <div class="${rowClass}">
      <span class="view-item-index">${index}</span>
      ${renderProductImageHTML(item.productSr, "view-product-image--thumb")}
      <div class="view-history-info">
        <span class="view-history-name">${escapeAttr(item.productName)}</span>
        ${materialHTML}
      </div>
      <div class="view-history-side">
        <span class="view-history-qty-label">${qtyMeta.label}</span>
        <span class="view-history-qty-value">${qtyText} ${unitHTML}</span>
        ${moneyHTML}
      </div>
    </div>
  `;
}

/* Summary metrics — a VIEW of data the draft already carries, never a
   new source of truth. Sums the same item.qty/priceType fields that
   already drive the current/history rows above and the printed
   invoice's Total Quantity line (buildTotalQuantityHTML); no new
   Firestore read, query, or persistent counter is introduced. */
function computeViewSummary(items) {
  let totalWeight = 0;
  let totalPieces = 0;

  items.forEach(item => {
    const qty = parseFloat(item.qty) || 0;
    if (item.priceType === "KG") {
      totalWeight += qty;
    } else if (item.priceType === "PP") {
      totalPieces += qty;
    }
  });

  return {
    totalWeight,
    totalPieces,
    totalItems: items.length
  };
}

function formatViewSummaryNumber(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function renderViewSummaryPanelHTML(items, showPrices, grandTotal) {
  const summary = computeViewSummary(items);
  const grandTotalHTML = showPrices
    ? `
      <div class="view-summary-grand-total">
        <span class="view-summary-label">Grand Total</span>
        <div class="view-summary-grand-value">₹${formatIndianMoneyWhole(grandTotal || 0)}</div>
      </div>
    `
    : "";

  return `
    <div class="view-summary-panel">
      <div class="view-summary-title">Total Quantity Added So Far</div>
      <div class="view-summary-metric view-summary-metric--blue">
        <div class="view-summary-icon">${VIEW_WEIGHT_ICON_SVG}</div>
        <div class="view-summary-text">
          <span class="view-summary-label">Total Weight</span>
          <div class="view-summary-value">${formatViewSummaryNumber(summary.totalWeight)}<span class="view-summary-unit">kg</span></div>
          <span class="view-summary-sub">Cumulative weight added so far</span>
        </div>
      </div>
      <div class="view-summary-metric view-summary-metric--green">
        <div class="view-summary-icon">${VIEW_PIECES_ICON_SVG}</div>
        <div class="view-summary-text">
          <span class="view-summary-label">Total Pieces</span>
          <div class="view-summary-value">${formatViewSummaryNumber(summary.totalPieces)}<span class="view-summary-unit">pcs</span></div>
          <span class="view-summary-sub">Cumulative pieces added so far</span>
        </div>
      </div>
      <div class="view-summary-metric view-summary-metric--purple">
        <div class="view-summary-icon">${VIEW_ITEMS_ICON_SVG}</div>
        <div class="view-summary-text">
          <span class="view-summary-label">Total Items Added</span>
          <div class="view-summary-value">${formatViewSummaryNumber(summary.totalItems)}</div>
          <span class="view-summary-sub">Items added so far</span>
        </div>
      </div>
      ${grandTotalHTML}
      <div class="view-summary-footer">
        ${VIEW_CLOCK_ICON_SVG}
        <span>Data is real-time and updates automatically as items are added.</span>
      </div>
    </div>
  `;
}

function renderViewCastPanelHTML(cast, draft) {
  if (!draft) {
    return `<div class="view-cast-panel view-cast-panel-loading"></div>`;
  }

  const showPrices = !!cast.displayPrice;
  const items = draft.items || [];
  const currentItem = items.length ? items[0] : null;
  const historyItems = items.length > 1 ? items.slice(1) : [];

  // Only plays the entrance transition when a NEW item has actually
  // arrived (see attachCastDraftListener), never on ordinary edits to
  // the same current item (price/qty changes), so live updates are
  // never delayed or interrupted by animation.
  const enterClass = draft._viewIsNewCurrentItem
    ? " view-current-item--enter"
    : "";

  const currentHTML = currentItem
    ? `<div class="view-current-item${enterClass}">${renderCurrentItemHTML(currentItem, showPrices, !!draft._viewCurrentQtyChanged, 1)}</div>`
    : "";
  // Consumed for this render — clear it so an unrelated re-render of
  // this same panel (triggered by another cast's snapshot) does not
  // replay the blink. The next genuine qty change on this session's
  // current item sets it again (see attachCastDraftListener).
  draft._viewCurrentQtyChanged = false;

  // historyItems is already newest-first (items.slice(1) of an array
  // where items[0] is current) — so index simply continues counting
  // down from the current item's "1", matching the reference's visual
  // ordering (top = most recently added = lowest number).
  const historyHTML = historyItems.length
    ? `<div class="view-history-list">${historyItems
        .map((item, i) => renderHistoryItemHTML(item, showPrices, i + 2))
        .join("")}</div>`
    : "";

  return `
    <div class="view-cast-panel">
      <div class="view-main-col">
        <div class="view-items-heading">Items Added</div>
        ${currentHTML}
        ${historyHTML}
        <div class="view-info-bar">
          ${VIEW_INFO_ICON_SVG}
          <span>This is a view only screen. No actions can be performed here.</span>
        </div>
      </div>
      <div class="view-summary-col">
        ${renderViewSummaryPanelHTML(items, showPrices, draft.subtotal || 0)}
      </div>
    </div>
  `;
}

function renderViewLivePanels() {
  if (!viewLiveStage || !viewActiveCasts.length) {
    return;
  }

  viewLiveStage.style.gridTemplateColumns =
    `repeat(${viewActiveCasts.length}, 1fr)`;

  // Purely local, cosmetic hook so CSS can scale current-item typography
  // down as more panels share the width (1/2/3/4 casts) — no Firestore
  // involvement, just an attribute selector.
  viewLiveStage.dataset.castCount = String(viewActiveCasts.length);

  viewLiveStage.innerHTML = viewActiveCasts
    .map(cast =>
      renderViewCastPanelHTML(cast, viewDraftCache[cast.sessionId])
    )
    .join("");
}

/* --- Cast handoff (View side) ---
   viewCastRef is the ONLY permanent listener the View screen keeps. It
   is a single small document, not the liveDraftBills collection, and it
   only changes on explicit Cast/End Cast/Show-Prices actions (a
   handful of times a day) — see the Firestore cost report for why a
   listener here is unavoidable for automatic, no-touch switching
   across separate devices. Only while casts are active does View also
   hold one temporary listener PER active cast (max 4), each directly
   on its existing liveDraftBills document — never the collection. */
function attachCastDraftListener(watchSessionId) {
  viewDraftUnsubs[watchSessionId] = onSnapshot(
    doc(db, "liveDraftBills", watchSessionId),
    draftSnap => {
      if (!draftSnap.exists()) {
        // This cast's draft is gone (finalized/cleared elsewhere, or an
        // abandoned session). Self-heal: remove just this cast from the
        // shared control doc so its slot frees up and the remaining
        // casts reflow — no heartbeat required for this to happen.
        delete viewDraftCache[watchSessionId];
        delete viewDraftItemCounts[watchSessionId];
        delete viewDraftCurrentQty[watchSessionId];
        removeCastFromControlDoc(watchSessionId);
        return;
      }

      const data = draftSnap.data();
      const itemCount = (data.items || []).length;
      const prevCount = viewDraftItemCounts[watchSessionId] || 0;

      // Local-only flag (never written back to Firestore) so the
      // current-item panel can play its brief entrance transition only
      // when a genuinely new item has arrived — not on every edit
      // (price/qty change) to the item that was already current.
      data._viewIsNewCurrentItem = itemCount > prevCount;
      viewDraftItemCounts[watchSessionId] = itemCount;

      // Local-only flag driving the "current weight" blink: true only
      // when the current item's qty is different from the last value
      // seen for this session (covers both a brand-new item and a
      // weight update on the same item), so the blink never replays on
      // unrelated re-renders (see renderViewCastPanelHTML, which
      // consumes and clears this flag once it's used).
      const currentItem = itemCount ? data.items[0] : null;
      const currentQty = currentItem ? currentItem.qty : null;
      data._viewCurrentQtyChanged =
        currentQty !== null && currentQty !== viewDraftCurrentQty[watchSessionId];
      viewDraftCurrentQty[watchSessionId] = currentQty;

      viewDraftCache[watchSessionId] = data;
      renderViewLivePanels();
    },
    err => {
      console.error("View draft listener error:", err);
    }
  );
}

function applyViewCasts(casts) {
  viewActiveCasts = casts;

  const activeIds = new Set(casts.map(c => c.sessionId));

  // Detach + drop cached data for any session no longer in the array
  // (only that one cast's listener is touched; the rest are untouched).
  for (const id of Object.keys(viewDraftUnsubs)) {
    if (!activeIds.has(id)) {
      viewDraftUnsubs[id]();
      delete viewDraftUnsubs[id];
      delete viewDraftCache[id];
      delete viewDraftItemCounts[id];
      delete viewDraftCurrentQty[id];
    }
  }

  // Attach a listener for any newly-added session (idempotent — skips
  // sessions that already have one).
  casts.forEach(cast => {
    if (!viewDraftUnsubs[cast.sessionId]) {
      attachCastDraftListener(cast.sessionId);
    }
  });

  if (!casts.length) {
    showSlideshowStage();
  } else {
    showLiveStage();
    renderViewLivePanels();
  }
}

function initViewCastListener() {
  if (viewCastControlUnsub) {
    return;
  }

  viewCastControlUnsub = onSnapshot(
    viewCastRef,
    snap => {
      const casts = snap.exists() ? normalizeCasts(snap.data()) : [];
      applyViewCasts(casts);
    },
    err => {
      console.error("View cast listener error:", err);
      applyViewCasts([]);
    }
  );
}

/* --- Entry point: called only when the View tab is actually opened, so
   Billing-only devices never pay for this listener. --- */
async function enterViewScreen() {
  loadSlideshowDurationConfig();
  await loadSlideshowImagesIntoMemory();
  initViewCastListener();

  // Only resume the slideshow clock if we're not already showing one or
  // more live casts (the cast listener above will call showLiveStage()
  // on its own if casts are in fact active).
  if (!viewActiveCasts.length) {
    startSlideshowTimer();
  }
}

/* ================================
   VIEW SLIDESHOW SETTINGS (config UI)
================================ */
let _viewSettingsRecords = [];
let _viewSettingsThumbUrls = [];

async function refreshViewSettingsRecords() {
  _viewSettingsThumbUrls.forEach(u => URL.revokeObjectURL(u));
  _viewSettingsThumbUrls = [];

  _viewSettingsRecords = await viewDbGetAllImages().catch(() => []);

  renderViewSettingsList();
}

function renderViewSettingsList() {
  if (!viewSlideList) {
    return;
  }

  if (!_viewSettingsRecords.length) {
    viewSlideList.innerHTML =
      `<div class="receiver-subtitle" style="padding:10px 0;">No photos yet</div>`;
    return;
  }

  viewSlideList.innerHTML = _viewSettingsRecords
    .map((rec, i) => {
      const url = URL.createObjectURL(rec.blob);
      _viewSettingsThumbUrls.push(url);

      return `
        <div class="view-slide-row" data-id="${escapeAttr(rec.id)}">
          <img src="${url}" class="view-slide-thumb" alt="">
          <div class="view-slide-name">${escapeAttr(rec.name || "Photo " + (i + 1))}</div>
          <div class="view-slide-row-actions">
            <button type="button" class="view-slide-move" data-action="up" ${i === 0 ? "disabled" : ""}>↑</button>
            <button type="button" class="view-slide-move" data-action="down" ${i === _viewSettingsRecords.length - 1 ? "disabled" : ""}>↓</button>
            <button type="button" class="view-slide-remove" data-action="remove">Remove</button>
          </div>
        </div>
      `;
    })
    .join("");
}

async function addViewSlideshowFiles(files) {
  const existing = await viewDbGetAllImages().catch(() => []);
  let nextOrder =
    existing.length
      ? Math.max(...existing.map(r => r.order)) + 1
      : 0;

  for (const file of files) {
    if (!file.type || !file.type.startsWith("image/")) {
      continue;
    }

    await viewDbPutImage({
      id: crypto.randomUUID(),
      blob: file,
      name: file.name,
      order: nextOrder++
    });
  }

  await refreshViewSettingsRecords();
}

async function moveViewSlideshowImage(id, direction) {
  const idx = _viewSettingsRecords.findIndex(r => r.id === id);
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;

  if (idx < 0 || swapIdx < 0 || swapIdx >= _viewSettingsRecords.length) {
    return;
  }

  const a = _viewSettingsRecords[idx];
  const b = _viewSettingsRecords[swapIdx];
  const aOrder = a.order;

  a.order = b.order;
  b.order = aOrder;

  await viewDbPutImage(a);
  await viewDbPutImage(b);
  await refreshViewSettingsRecords();
}

async function removeViewSlideshowImage(id) {
  await viewDbDeleteImage(id);
  await refreshViewSettingsRecords();
}

/* PPT/PPTX import — isolated, best-effort convenience.
   A browser cannot faithfully render arbitrary PPTX slide layouts/text
   as a reliable full-screen slideshow without a large rendering engine
   or server-side conversion, which this frontend-only app doesn't have.
   What IS safely and reliably doable here: a .pptx file is a zip archive,
   so we extract the photos already embedded in it (ppt/media/*) and add
   them to the slideshow as images. This never touches the core casting
   feature even if it fails. */
async function importPptPhotos(file) {
  if (!file) {
    return;
  }

  try {
    const JSZipModule = await import(
      "https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm"
    );
    const JSZip = JSZipModule.default || JSZipModule;

    const zip = await JSZip.loadAsync(file);
    const mediaFiles = Object.keys(zip.files).filter(
      name =>
        /^ppt\/media\//i.test(name) &&
        /\.(png|jpe?g|gif|bmp|webp)$/i.test(name)
    );

    if (!mediaFiles.length) {
      showToast("No photos found inside that file", "error");
      return;
    }

    const existing = await viewDbGetAllImages().catch(() => []);
    let nextOrder =
      existing.length
        ? Math.max(...existing.map(r => r.order)) + 1
        : 0;

    for (const name of mediaFiles) {
      const blob = await zip.files[name].async("blob");

      await viewDbPutImage({
        id: crypto.randomUUID(),
        blob,
        name: name.split("/").pop(),
        order: nextOrder++
      });
    }

    await refreshViewSettingsRecords();
    showToast(
      `Imported ${mediaFiles.length} photo${mediaFiles.length !== 1 ? "s" : ""} from PPT`,
      "success"
    );
  } catch (err) {
    console.error("PPT import failed:", err);
    showToast("Could not import photos from that file", "error");
  }
}

if (viewSettingsBtn) {
  viewSettingsBtn.addEventListener("click", async () => {
    loadSlideshowDurationConfig();
    if (viewDurationInput) {
      viewDurationInput.value = viewSlideshowDurationSec;
    }
    await refreshViewSettingsRecords();
    viewSettingsModal.style.display = "flex";
  });
}

if (closeViewSettings) {
  closeViewSettings.addEventListener("click", () => {
    viewSettingsModal.style.display = "none";
  });
}

if (viewAddPhotosBtn) {
  viewAddPhotosBtn.addEventListener("click", () => {
    viewAddPhotosInput.click();
  });
}

if (viewAddPhotosInput) {
  viewAddPhotosInput.addEventListener("change", async () => {
    if (viewAddPhotosInput.files.length) {
      await addViewSlideshowFiles(Array.from(viewAddPhotosInput.files));
    }
    viewAddPhotosInput.value = "";
  });
}

if (viewImportPptBtn) {
  viewImportPptBtn.addEventListener("click", () => {
    viewImportPptInput.click();
  });
}

if (viewImportPptInput) {
  viewImportPptInput.addEventListener("change", async () => {
    if (viewImportPptInput.files.length) {
      await importPptPhotos(viewImportPptInput.files[0]);
    }
    viewImportPptInput.value = "";
  });
}

if (viewSlideList) {
  viewSlideList.addEventListener("click", e => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) {
      return;
    }

    const row = btn.closest(".view-slide-row");
    const id = row && row.dataset.id;
    if (!id) {
      return;
    }

    const action = btn.dataset.action;

    if (action === "up" || action === "down") {
      moveViewSlideshowImage(id, action);
    } else if (action === "remove") {
      removeViewSlideshowImage(id);
    }
  });
}

if (viewSettingsSave) {
  viewSettingsSave.addEventListener("click", async () => {
    const seconds = Math.max(
      2,
      Math.min(120, Number(viewDurationInput.value) || 10)
    );

    localStorage.setItem(VIEW_DURATION_KEY, String(seconds));
    viewSlideshowDurationSec = seconds;

    viewSettingsModal.style.display = "none";

    await loadSlideshowImagesIntoMemory();

    // Only restart the clock if the slideshow is actually the visible
    // stage right now (i.e. no casts are active).
    if (!viewActiveCasts.length) {
      startSlideshowTimer();
    }
  });
}

/* --- Fullscreen (wall display) ---
   Uses the browser's native Fullscreen API only. When #viewView is the
   fullscreen element, the browser itself removes the rest of the page
   (nav tabs, everything outside #viewView) from view — no extra CSS is
   needed for that part. We only need to hide the small settings/
   fullscreen buttons that live inside #viewView itself (see CSS
   ":fullscreen" rules), and keep them back in sync on exit (Esc/F11). */
if (viewFullscreenBtn) {
  viewFullscreenBtn.addEventListener("click", () => {
    if (!document.fullscreenElement) {
      viewView.requestFullscreen().catch(err => {
        console.error("Failed to enter fullscreen:", err);
      });
    } else {
      document.exitFullscreen();
    }
  });
}

document.addEventListener("fullscreenchange", () => {
  document.body.classList.toggle(
    "view-fullscreen-mode",
    document.fullscreenElement === viewView
  );
});

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
    revisedBill.customerName !== "Retail Bill" &&
    revisedBill.customerName.trim().toLowerCase() !== "test"
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
        <div class="copy-label office-copy-label" style="background-color:#000000;color:#ffffff;width:fit-content;margin:0 auto;padding:1px 6px;box-sizing:border-box;">OFFICE COPY</div>

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
async function loadProducts({ forceRefresh = false } = {}) {
  try {
    const todayStr = getIndiaTodayDate();
    const cacheRaw =
      forceRefresh
        ? null
        : localStorage.getItem("catalogCache");

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

    /*
     * Snapshot last-known stock from the in-memory products BEFORE they're
     * replaced below. catalog/current never carries a stock field (the
     * separate Universal Pricelist app's schema has no concept of stock),
     * so on every refresh p.s starts out undefined for every product and
     * is normally restored by the ledger read further down. If that read
     * fails (network blip, transient rule/permission hiccup, offline),
     * this snapshot is the fallback — so a single failed read can no
     * longer zero out every product's visible stock. It only ever holds
     * what was already showing in the UI, so this is strictly safer than
     * the previous behavior, never less accurate.
     */
    const previousStockBySr = new Map();
    productsBySr.forEach((p, sr) => {
      if (p.s !== undefined) previousStockBySr.set(sr, p.s);
    });

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

    /*
     * Stock ("s") is authoritative in appConfig/updateSignal.stock, NOT in
     * catalog/current — the separate Universal Pricelist app periodically
     * overwrites the whole catalog/current.products array from its own
     * price-editing form, which has no concept of stock, wiping any "s"
     * stored there. Reading from a document that tool never touches means
     * pricelist updates can no longer affect stock.
     *
     * Any product whose stock is only known via catalog/current (e.g. a
     * value saved before this fix shipped) is opportunistically copied
     * into the durable ledger here, so it survives future pricelist
     * updates too — this is what makes a one-off migration unnecessary.
     */
    try {
      const stockSnap = await getDoc(updateSignalRef);
      const stockLedger =
        (stockSnap.exists() && stockSnap.data().stock) || {};
      const backfill = {};

      products.forEach(p => {
        const key = String(p.sr);
        if (Object.prototype.hasOwnProperty.call(stockLedger, key)) {
          p.s = stockLedger[key];
        } else if (p.s !== undefined) {
          backfill[key] = p.s;
        } else if (previousStockBySr.has(p.sr)) {
          // Ledger doesn't have this product yet (e.g. this exact write
          // hasn't replicated to this read) — don't drop what the UI
          // already showed; carry it forward instead of falling to 0.
          p.s = previousStockBySr.get(p.sr);
        }
      });

      if (Object.keys(backfill).length) {
        backfillStockLedger(backfill);
      }
    } catch (err) {
      console.warn("Could not load stock ledger, keeping last-known stock values:", err);
      // The ledger read itself failed — fall back to whatever was already
      // in memory for every product, instead of leaving p.s undefined
      // (which the UI would render as 0) for the entire catalog.
      products.forEach(p => {
        if (previousStockBySr.has(p.sr)) {
          p.s = previousStockBySr.get(p.sr);
        }
      });
    }

    productsBySr.clear();

    products.forEach(
      p => productsBySr.set(p.sr, p)
    );

    renderInventoryOverview();

    if (!forceRefresh) {
      restoreDraft();
    }

    return true;

  } catch (err) {
    console.error(err);
    showToast(
      forceRefresh
        ? "Failed to update prices"
        : "Failed to load products",
      "error"
    );
    return false;
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
  viewView.style.display =
    "none";
  daybookView.style.display =
    "none";

  billingTab.classList.remove(
    "active"
  );
  receiverTab.classList.remove(
    "active"
  );
  viewTab.classList.remove(
    "active"
  );
  daybookTab.classList.remove(
    "active"
  );

  // Leaving the View screen: stop the slideshow timer so a hidden tab
  // doesn't keep ticking in the background. It resumes from the same
  // position (viewSlideshowIndex is untouched) when View is reopened.
  if (view !== "view") {
    pauseSlideshow();
  }

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

  if (view === "view") {
    viewView.style.display =
      "block";

    viewTab.classList.add(
      "active"
    );

    enterViewScreen();
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

viewTab.addEventListener(
  "click",
  () => activateView("view")
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

if (prepareViewDisplayBtn) {
  prepareViewDisplayBtn.addEventListener("click", () => {
    prepareViewDisplayImages();
  });
}

/* ================================
   MANUAL PRICE UPDATE SIGNAL
================================ */
let latestUpdateSignal = 0;
let isUpdatingCatalog = false;
let updatePopupVisible = false;

adminSignalBtn.addEventListener(
  "click",
  async () => {
    try {
      await setDoc(
        updateSignalRef,
        {
          signal: increment(1),
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
    } catch (err) {
      console.error(err);
    }
  }
);

updatePricelistBtn.addEventListener(
  "click",
  async () => {
    if (isUpdatingCatalog) {
      return;
    }

    isUpdatingCatalog = true;
    updatePricelistBtn.disabled = true;

    const success =
      await loadProducts({ forceRefresh: true });

    isUpdatingCatalog = false;
    updatePricelistBtn.disabled = false;

    updatePricelistModal.style.display = "none";
    updatePopupVisible = false;

    if (success) {
      try {
        localStorage.setItem(
          LAST_PROCESSED_SIGNAL_KEY,
          String(latestUpdateSignal)
        );
      } catch (e) {
        console.warn(
          "Could not save lastProcessedSignal:",
          e
        );
      }

      showToast(
        "Pricelist updated successfully.",
        "success"
      );
    } else {
      showToast(
        "Failed to update pricelist.",
        "error"
      );
    }
  }
);

/* ================================
   MODE + SEARCH UI
================================ */
function applyModeStyle(mode) {
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
          class="suggestion-card ${product.material ? getMaterialClass(product.material) : ""}"
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
  updateCastButtonUI();

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

castViewBtn.addEventListener(
  "click",
  () => {
    if (myCastActive) {
      endViewCast();
    } else {
      startViewCast();
    }
  }
);

if (showPricesToggle) {
  showPricesToggle.addEventListener("click", () => {
    toggleShowPrices();
  });
}

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
          sr:
            item.product.sr,

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

    confirmSend.disabled = true;
    const _confirmSendOriginalLabel = confirmSend.textContent;
    confirmSend.textContent = "Sending…";

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

      confirmSend.disabled = false;
      confirmSend.textContent = _confirmSendOriginalLabel;
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
        <div class="copy-label${label === 'OFFICE COPY' ? ' office-copy-label' : ''}" ${label === 'OFFICE COPY' ? 'style="background-color:#000000;color:#ffffff;width:fit-content;margin:0 auto;padding:1px 6px;box-sizing:border-box;"' : ''}>${label}</div>

        <div class="print-header-row">
          ${billData.customerName && billData.customerName !== "Retail Bill" && billData.customerName.trim().toLowerCase() !== "test"
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

// One-time check (not a listener) so that if Billing is refreshed while
// this session owns an active cast, the "End Cast" / Show Prices button
// state is restored instead of drifting out of sync with viewCastRef.
(async function restoreCastOwnershipOnLoad() {
  try {
    const snap = await getDoc(viewCastRef);
    const casts = snap.exists() ? normalizeCasts(snap.data()) : [];
    const mine = casts.find(c => c.sessionId === sessionId);

    if (mine) {
      myCastActive = true;
      myCastDisplayPrice = !!mine.displayPrice;
      updateCastButtonUI();
    }
  } catch (err) {
    // Non-fatal — button simply stays in the default "Cast to View" state.
  }
})();

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

onSnapshot(
  inventorySalesCollection,
  snapshot => {
    snapshot.docChanges().forEach(
      change => {
        if (change.type === "removed") {
          delete inventorySalesCache[change.doc.id];
        } else {
          inventorySalesCache[change.doc.id] =
            change.doc.data();
        }
      }
    );

    renderInventoryOverview();
  }
);

let isInitialSnapshot = true;

onSnapshot(
  updateSignalRef,
  snap => {
    if (!snap.exists()) {
      isInitialSnapshot = false;
      return;
    }

    const remoteSignal =
      snap.data().signal || 0;

    latestUpdateSignal = remoteSignal;

    if (isInitialSnapshot) {
      isInitialSnapshot = false;
      return;
    }

    let localSignal = 0;

    try {
      localSignal =
        Number(
          localStorage.getItem(
            LAST_PROCESSED_SIGNAL_KEY
          )
        ) || 0;
    } catch (e) {}

    if (
      remoteSignal > localSignal &&
      !isUpdatingCatalog &&
      !updatePopupVisible
    ) {
      updatePopupVisible = true;
      updatePricelistModal.style.display = "flex";
    }
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
                ? ""
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

/* ================================
   INVENTORY (STOCK MANAGEMENT)
================================ */
daybookFooterDate.textContent =
  getIndiaDateInfo().displayDate;

let _inventorySelectedSr = null;
let _inventorySearchTimer = null;
let _inventorySaving = false;
let _inventoryMode = "stock";

function openInventoryPasswordModal() {
  inventoryPasswordInput.value = "";
  inventoryPasswordModal.style.display = "flex";
  inventoryPasswordInput.focus();
}

async function verifyInventoryPassword() {
  const entered = inventoryPasswordInput.value;
  inventoryPasswordModal.style.display = "none";

  if (!entered) {
    return;
  }

  try {
    const ok = await bcrypt.compare(
      entered,
      INVENTORY_PASSWORD_HASH
    );

    if (ok) {
      openInventoryModal();
    }
  } catch (err) {
    console.error(err);
  }
}

daybookFooterDate.addEventListener(
  "click",
  openInventoryPasswordModal
);

inventoryPasswordContinue.addEventListener(
  "click",
  verifyInventoryPassword
);

inventoryPasswordInput.addEventListener(
  "keydown",
  e => {
    if (e.key === "Enter") {
      verifyInventoryPassword();
    }
    if (e.key === "Escape") {
      inventoryPasswordModal.style.display = "none";
    }
  }
);

function openInventoryModal() {
  _inventorySelectedSr = null;
  inventorySearchBox.value = "";
  inventorySuggestions.innerHTML = "";
  inventoryClearSearch.style.display = "none";
  inventoryEditorView.style.display = "none";
  inventorySearchView.style.display = "block";
  setInventoryMode("stock");
  inventoryModal.style.display = "flex";
  inventorySearchBox.focus();
}

function closeInventoryModal() {
  inventoryModal.style.display = "none";
}

inventoryCloseBtn.addEventListener(
  "click",
  closeInventoryModal
);

function getProductSalesQty(sr) {
  const record =
    inventorySalesCache[String(sr)];
  const qty =
    record ? Number(record.qtySold) || 0 : 0;
  return Math.max(0, qty);
}

function setInventoryMode(mode) {
  _inventoryMode =
    mode === "sales" ? "sales" : "stock";

  inventoryStockModeBtn.classList.toggle(
    "inventory-mode-active",
    _inventoryMode === "stock"
  );
  inventorySalesModeBtn.classList.toggle(
    "inventory-mode-active",
    _inventoryMode === "sales"
  );

  inventorySearchBox.placeholder =
    _inventoryMode === "sales"
      ? "Search product sales..."
      : "Search product stock...";

  inventoryOverviewTitle.textContent =
    _inventoryMode === "sales"
      ? "Sales Overview"
      : "Stock Overview";

  inventoryResetSalesBtn.style.display =
    _inventoryMode === "sales"
      ? "inline-flex"
      : "none";
  inventoryPrintSalesBtn.style.display =
    _inventoryMode === "sales"
      ? "inline-flex"
      : "none";

  _inventorySelectedSr = null;
  inventoryEditorView.style.display = "none";
  inventorySearchView.style.display = "block";
  inventorySearchBox.value = "";
  inventorySuggestions.innerHTML = "";
  inventoryClearSearch.style.display = "none";
  renderInventoryOverview();
  inventorySearchBox.focus();
}

inventoryStockModeBtn.addEventListener(
  "click",
  () => setInventoryMode("stock")
);

inventorySalesModeBtn.addEventListener(
  "click",
  () => setInventoryMode("sales")
);

function getInventoryOverviewRows() {
  const rows =
    products.map(product => {
      const qty =
        _inventoryMode === "sales"
          ? getProductSalesQty(product.sr)
          : Math.max(0, Number(product.s) || 0);

      return {
        product,
        qty
      };
    })
      .filter(row => row.qty > 0)
      .sort((a, b) => b.qty - a.qty);

  return rows;
}

function renderInventoryOverview() {
  if (!inventoryOverviewList) {
    return;
  }

  const rows =
    getInventoryOverviewRows();

  if (!rows.length) {
    inventoryOverviewList.innerHTML = `
      <div class="empty-state">
        ${_inventoryMode === "sales" ? "No sales since reset" : "No stock available"}
      </div>
    `;
    return;
  }

  inventoryOverviewList.innerHTML =
    rows.map(row => `
      <div class="inventory-overview-row">
        <div class="inventory-overview-name">
          ${escapeAttr(row.product.productName)}
        </div>
        <div class="inventory-overview-qty">
          ${roundQty(row.qty)}
        </div>
      </div>
    `).join("");
}

function buildSalesOverviewPrintHTML() {
  const rows =
    getInventoryOverviewRows();

  const body =
    rows.length
      ? rows.map(row => `
          <tr>
            <td>${escapeAttr(row.product.productName)}</td>
            <td>${escapeAttr(shortMaterialName(row.product.material))}</td>
            <td>${roundQty(row.qty)}</td>
          </tr>
        `).join("")
      : `
          <tr>
            <td colspan="3">No sales since reset</td>
          </tr>
        `;

  return `
    <div class="print-wrapper sales-print-wrapper">
      <div class="sales-print-title">SALES SINCE LAST RESET</div>
      <table class="sales-print-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Mat</th>
            <th>Quantity Sold</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

function printSalesOverview() {
  printInvoice.innerHTML =
    buildSalesOverviewPrintHTML();

  window.print();
}

inventoryPrintSalesBtn.addEventListener(
  "click",
  () => {
    if (_inventoryMode === "sales") {
      printSalesOverview();
    }
  }
);

/* Reuses searchProducts()/escapeAttr()/getMaterialClass() exactly as used
   by the Billing search — only the rendered card and click target differ,
   since selecting a product here opens the stock editor instead of adding
   it to the bill. */
function renderInventorySuggestions(results) {
  if (!results.length) {
    inventorySuggestions.innerHTML = "";
    return;
  }

  let html = "";

  results.forEach(product => {
    html += `
      <div
        class="suggestion-card ${product.material ? getMaterialClass(product.material) : ""}"
        onclick="selectInventoryProduct(${product.sr})"
      >
        <div class="suggestion-layout">
          <div class="suggestion-info">
            <div class="suggestion-name">
              ${escapeAttr(product.productName)}
            </div>
            <div class="badge-row">
              ${
                _inventoryMode === "sales"
                  ? `<div class="unit">Sold Since Reset: ${roundQty(getProductSalesQty(product.sr))}</div>`
                  : `
                    <div class="unit">
                      ${escapeAttr(product.priceType || "")}
                    </div>
                    ${
                      product.material
                        ? `<div class="unit ${getMaterialClass(product.material)}">${escapeAttr(product.material)}</div>`
                        : ""
                    }
                    <div class="unit">Current Stock: ${roundQty(Math.max(0, Number(product.s) || 0))}</div>
                  `
              }
            </div>
          </div>
        </div>
      </div>
    `;
  });

  inventorySuggestions.innerHTML = html;
}

inventorySearchBox.addEventListener(
  "input",
  e => {
    const value = e.target.value;

    inventoryClearSearch.style.display =
      value ? "flex" : "none";

    if (!value.trim()) {
      if (_inventorySearchTimer) {
        clearTimeout(_inventorySearchTimer);
        _inventorySearchTimer = null;
      }
      inventorySuggestions.innerHTML = "";
      return;
    }

    if (_inventorySearchTimer) {
      clearTimeout(_inventorySearchTimer);
    }

    _inventorySearchTimer = setTimeout(() => {
      renderInventorySuggestions(
        searchProducts(value)
      );
    }, 60);
  }
);

inventoryClearSearch.addEventListener(
  "click",
  () => {
    inventorySearchBox.value = "";
    inventorySuggestions.innerHTML = "";
    inventoryClearSearch.style.display = "none";
    inventorySearchBox.focus();
  }
);

window.selectInventoryProduct = function(sr) {
  const product = productsBySr.get(sr);

  if (!product) {
    return;
  }

  _inventorySelectedSr = sr;
  inventoryProductName.textContent = product.productName;

  if (_inventoryMode === "sales") {
    inventoryStockEditorFields.style.display = "none";
    inventorySaveBtn.style.display = "none";
    inventorySalesReadout.style.display = "block";
    inventorySalesReadout.textContent =
      `Sold Since Reset: ${roundQty(getProductSalesQty(sr))}`;
  } else {
    inventoryStockEditorFields.style.display = "block";
    inventorySaveBtn.style.display = "inline-flex";
    inventorySalesReadout.style.display = "none";
    inventoryCodeInput.value = Math.max(0, Number(product.s) || 0);
  }

  inventorySearchView.style.display = "none";
  inventoryEditorView.style.display = "block";
};

inventoryCancelBtn.addEventListener(
  "click",
  () => {
    _inventorySelectedSr = null;
    inventoryEditorView.style.display = "none";
    inventorySearchView.style.display = "block";
    inventorySaveBtn.style.display = "inline-flex";
    inventorySearchBox.focus();
  }
);

/**
 * Writes dotted-path field updates (e.g. "stock.451") to updateSignalRef
 * as genuine nested-field merges. setDoc(ref, {"stock.451": 1}, {merge:
 * true}) does NOT do this — that writes a literal top-level field named
 * "stock.451" (dot included in the field name), not a nested field under
 * a "stock" map, so reads expecting doc.data().stock never see it. Only
 * updateDoc() (or setDoc's separate mergeFields array) actually parses
 * dotted keys as field paths. updateDoc() throws if the document doesn't
 * exist yet, so this falls back to a one-time setDoc to create it.
 */
async function writeStockFields(updates) {
  try {
    await updateDoc(updateSignalRef, updates);
  } catch (err) {
    if (err && err.code === "not-found") {
      await setDoc(updateSignalRef, updates, { merge: true });
    } else {
      throw err;
    }
  }
}

/**
 * Best-effort: persists any stock values into the durable ledger
 * (appConfig/updateSignal.stock) that were only known via catalog/current
 * at load time. Failures are logged only — this is opportunistic, never
 * required for correctness of the current session.
 */
async function backfillStockLedger(map) {
  try {
    const updates = {};
    Object.entries(map).forEach(([sr, val]) => {
      updates[`stock.${sr}`] = val;
    });

    await writeStockFields(updates);
  } catch (err) {
    console.warn("Stock ledger backfill failed:", err);
  }
}

/**
 * Persists product.s for a single product into the durable stock ledger
 * (appConfig/updateSignal.stock), NOT into catalog/current — the separate
 * Universal Pricelist app periodically overwrites the whole
 * catalog/current.products array from its own price-editing form, which
 * has no concept of stock, so anything stored there is not durable.
 * updateSignalRef is a document this app already owns and the pricelist
 * tool never touches, so writing here survives pricelist updates. A
 * dotted field path keeps this a single, minimal Firestore write that
 * touches only this one product's entry in the map.
 */
async function saveProductStockValue(sr, newValue) {
  if (!Number.isFinite(newValue) || newValue < 0) {
    throw new Error("Stock cannot be negative.");
  }

  await writeStockFields({ [`stock.${sr}`]: newValue });

  const local = productsBySr.get(sr);
  if (local) {
    local.s = newValue;
  }
}

inventorySaveBtn.addEventListener(
  "click",
  async () => {
    if (_inventorySaving || _inventorySelectedSr == null) {
      return;
    }

    const newValue = Number(inventoryCodeInput.value);

    if (!Number.isFinite(newValue)) {
      return;
    }

    if (newValue < 0) {
      showToast("Stock cannot be negative", "error");
      return;
    }

    _inventorySaving = true;
    inventorySaveBtn.disabled = true;

    try {
      await saveProductStockValue(
        _inventorySelectedSr,
        newValue
      );
      renderInventoryOverview();
    } catch (err) {
      console.error("Failed to save stock:", err);
      showToast("Failed to save stock", "error");
    } finally {
      _inventorySaving = false;
      inventorySaveBtn.disabled = false;
    }

    _inventorySelectedSr = null;
    inventoryEditorView.style.display = "none";
    inventorySearchView.style.display = "block";
    inventorySearchBox.value = "";
    inventorySuggestions.innerHTML = "";
    inventorySearchBox.focus();
  }
);

inventoryResetSalesBtn.addEventListener(
  "click",
  async () => {
    if (_inventoryMode !== "sales") {
      return;
    }

    const confirmed = confirm(
      "Reset all sales counters?\n\nAll sales quantities since the last reset will be permanently deleted."
    );

    if (!confirmed) {
      return;
    }

    inventoryResetSalesBtn.disabled = true;

    try {
      const snap =
        await getDocs(inventorySalesCollection);
      const batches = [];
      let batch = writeBatch(db);
      let count = 0;

      snap.docs.forEach(docSnap => {
        batch.delete(docSnap.ref);
        count++;

        if (count === 500) {
          batches.push(batch);
          batch = writeBatch(db);
          count = 0;
        }
      });

      if (count > 0) {
        batches.push(batch);
      }

      for (const pendingBatch of batches) {
        await pendingBatch.commit();
      }

      inventorySalesCache = {};
      renderInventoryOverview();
      showToast("Sales counters reset", "success");
    } catch (err) {
      console.error("Failed to reset sales counters:", err);
      showToast("Failed to reset sales counters", "error");
    } finally {
      inventoryResetSalesBtn.disabled = false;
    }
  }
);

function aggregateBillItemQuantities(items) {
  const deltas = new Map();

  if (!Array.isArray(items)) {
    return deltas;
  }

  items.forEach(item => {
    if (item.sr == null) {
      return;
    }

    const qty = Number(item.qty) || 0;

    if (qty <= 0) {
      return;
    }

    const key = String(item.sr);
    deltas.set(key, (deltas.get(key) || 0) + qty);
  });

  return deltas;
}

function createInventoryAccountingPlan(billId, bill) {
  const deltas =
    aggregateBillItemQuantities(bill.items);

  return {
    billId,
    markerRef:
      doc(inventoryAccountingCollection, billId),
    deltas
  };
}

async function readInventoryAccountingSnapshots(transaction, plans) {
  const markerSnaps = new Map();
  const uniqueSrs = new Set();

  for (const plan of plans) {
    markerSnaps.set(
      plan.billId,
      await transaction.get(plan.markerRef)
    );

    if (!markerSnaps.get(plan.billId).exists()) {
      plan.deltas.forEach((qty, sr) => {
        if (qty > 0) {
          uniqueSrs.add(sr);
        }
      });
    }
  }

  const stockSnap =
    await transaction.get(updateSignalRef);
  const salesSnaps = new Map();

  for (const sr of uniqueSrs) {
    salesSnaps.set(
      sr,
      await transaction.get(
        doc(inventorySalesCollection, sr)
      )
    );
  }

  return {
    markerSnaps,
    stockSnap,
    salesSnaps
  };
}

function applyInventoryAccountingWrites(transaction, plans, snapshots) {
  const stockLedger =
    (snapshots.stockSnap.exists() && snapshots.stockSnap.data().stock) || {};
  const stockPatch = {};
  const salesTotals = new Map();
  const accountedPlans = [];

  plans.forEach(plan => {
    const markerSnap =
      snapshots.markerSnaps.get(plan.billId);

    if (markerSnap && markerSnap.exists()) {
      return;
    }

    plan.deltas.forEach((qty, sr) => {
      salesTotals.set(sr, (salesTotals.get(sr) || 0) + qty);

      const localStock =
        productsBySr.get(Number(sr))?.s ?? 0;
      const currentStock =
        Object.prototype.hasOwnProperty.call(stockLedger, sr)
          ? Number(stockLedger[sr]) || 0
          : Number(localStock) || 0;
      const currentPatchedStock =
        Object.prototype.hasOwnProperty.call(stockPatch, sr)
          ? stockPatch[sr]
          : currentStock;

      stockPatch[sr] =
        Math.max(0, currentPatchedStock - qty);
    });

    accountedPlans.push(plan);
  });

  if (Object.keys(stockPatch).length) {
    if (snapshots.stockSnap.exists()) {
      const stockUpdates = {};
      Object.entries(stockPatch).forEach(([sr, value]) => {
        stockUpdates[`stock.${sr}`] = value;
      });
      transaction.update(updateSignalRef, stockUpdates);
    } else {
      transaction.set(
        updateSignalRef,
        { stock: stockPatch },
        { merge: true }
      );
    }
  }

  salesTotals.forEach((qty, sr) => {
    const salesSnap =
      snapshots.salesSnaps.get(sr);
    const currentSold =
      salesSnap && salesSnap.exists()
        ? Number(salesSnap.data().qtySold) || 0
        : 0;

    transaction.set(
      doc(inventorySalesCollection, sr),
      {
        qtySold:
          currentSold + qty
      },
      { merge: true }
    );
  });

  accountedPlans.forEach(plan => {
    transaction.set(
      plan.markerRef,
      {
        billId:
          plan.billId,
        accountedAt:
          serverTimestamp()
      }
    );
  });

  return {
    stockPatch,
    salesTotals
  };
}

function applyLocalInventoryAccountingResult(result) {
  if (!result || !result.stockPatch) {
    return;
  }

  Object.entries(result.stockPatch).forEach(([sr, value]) => {
    const local = productsBySr.get(Number(sr));
    if (local) {
      local.s = value;
    }
  });

  renderInventoryOverview();
}

window.doneReceivedBill =
  async function(docId) {
    if (
      isReceiverBusy
    ) {
      return;
    }

    const { confirmed, bulkAll } =
      await showDonePasswordDialog();

    if (!confirmed) {
      return;
    }

    // ── BULK: move every eligible today's printed bill ──
    if (bulkAll) {
      // incomingBillCache is already scoped to today by the Firestore query
      // (where createdAt >= startOfToday), so no date comparison is needed.
      const eligibleIds =
        Object.keys(incomingBillCache)
          .filter(id => {
            const b = incomingBillCache[id];
            return (
              b.effectiveVersion !== false &&
              b.status === "printed"
            );
          });

      if (!eligibleIds.length) {
        showToast(
          "No pending Receiver bills found for today.",
          "info"
        );
        return;
      }

      isReceiverBusy = true;

      let movedCount = 0;
      let accountingResult = null;

      try {
        await runTransaction(
          db,
          async transaction => {
            movedCount = 0;
            accountingResult = null;

            // Firestore requires all reads to complete before any writes inside
            // a transaction. Read sequentially to satisfy this constraint.
            const snaps = [];
            for (const id of eligibleIds) {
              const snap = await transaction.get(doc(db, "bills", id));
              snaps.push({ id, snap });
            }

            const billsToMove = [];
            const accountingPlans = [];

            for (const { id, snap } of snaps) {
              if (!snap.exists()) continue;

              const bill = snap.data();

              // Re-validate inside transaction (Firestore server state may differ)
              if (
                bill.status !== "printed" ||
                bill.effectiveVersion === false
              ) {
                continue;
              }

              const chainIds    = getBillChainIds(id);
              const chainToLock = chainIds.filter(cid => cid !== id);

              billsToMove.push({
                id,
                bill,
                chainToLock
              });
              accountingPlans.push(
                createInventoryAccountingPlan(id, bill)
              );
            }

            const accountingSnapshots =
              await readInventoryAccountingSnapshots(
                transaction,
                accountingPlans
              );

            accountingResult =
              applyInventoryAccountingWrites(
                transaction,
                accountingPlans,
                accountingSnapshots
              );

            // Queue all Daybook/bill writes after every transaction read is done.
            for (const { id, bill, chainToLock } of billsToMove) {
              const billRef = doc(db, "bills", id);

              transaction.set(
                doc(daybookCollection),
                {
                  date:         bill.date,
                  serialNumber: bill.serialNumber,
                  customerName: bill.customerName,
                  amount:       bill.grandTotal,
                  mode:         bill.mode || "W",
                  createdAt:    serverTimestamp()
                }
              );

              transaction.delete(billRef);

              chainToLock.forEach(cid => {
                transaction.update(
                  doc(db, "bills", cid),
                  { isLocked: true }
                );
              });
            }

            movedCount =
              billsToMove.length;
          }
        );

        showToast(
          `Successfully moved ${movedCount} bill${movedCount !== 1 ? "s" : ""} to Daybook.`,
          "success"
        );

        applyLocalInventoryAccountingResult(accountingResult);
      } catch (err) {
        console.error(err);
        showToast("Failed to complete bills", "error");
      } finally {
        isReceiverBusy = false;
      }

      return;
    }

    // ── SINGLE BILL (original behaviour) ──
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

    let accountingResult = null;

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

          if (
            bill.effectiveVersion === false
          ) {
            throw new Error(
              "Only the effective bill version can be completed."
            );
          }

          const accountingPlans = [
            createInventoryAccountingPlan(
              docId,
              bill
            )
          ];

          const accountingSnapshots =
            await readInventoryAccountingSnapshots(
              transaction,
              accountingPlans
            );

          accountingResult =
            applyInventoryAccountingWrites(
              transaction,
              accountingPlans,
              accountingSnapshots
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

      applyLocalInventoryAccountingResult(accountingResult);
    } catch (err) {
      console.error(err);

      showToast("Failed to complete bill", "error");
    } finally {
      isReceiverBusy =
        false;
    }
  };
