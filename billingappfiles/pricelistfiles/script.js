/* ================================
   GLOBAL STATE
================================ */
let products = [];
let currentMode = "W";
let lastResults = [];
let activeMaterial = null;

/* ================================
   DOM ELEMENTS
================================ */
const searchInput = document.getElementById("searchInput");
const resultsDiv = document.getElementById("results");
const clearBtn = document.getElementById("clearSearch");
const modeToggle = document.getElementById("modeToggle");

const materialFilter = document.getElementById("materialFilter");
const filterButtons = document.querySelectorAll(".filter-btn");

/* ================================
   LAST APP MEMORY + AUTO ROUTE
================================ */
(function() {
  var prev = localStorage.getItem("lastApp");
  localStorage.setItem("lastApp", "pricelist");
  if (
    prev === "billing" &&
    !sessionStorage.getItem("didAutoRedirect") &&
    sessionStorage.getItem("intentionalAppSwitch") !== "true"
  ) {
    sessionStorage.setItem("didAutoRedirect", "true");
    window.location.replace("../bill.html");
    return;
  }
  sessionStorage.removeItem("intentionalAppSwitch");
})();

/* ================================
   APP SWITCHER
================================ */
document.getElementById("billingSwitchBtn").addEventListener("click", () => {
  sessionStorage.setItem("intentionalAppSwitch", "true");
  localStorage.setItem("lastApp", "billing");
  window.location.href = "../bill.html";
});

/* ================================
   INITIAL BUTTON STATE
================================ */
modeToggle.innerText = "W";
modeToggle.style.background = "#2f3f64";

/* ================================
   NORMALIZE TEXT
================================ */
function normalize(text) {

  return text
    .toString()
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ================================
   TOKENIZE
================================ */
function tokenize(text) {

  return normalize(text)
    .split(" ")
    .filter(Boolean);
}

/* ================================
   LOAD DATA
================================ */
fetch("data.json")
  .then(res => res.json())
  .then(data => {

    products = data.map(product => {

      const searchableText = normalize(
        product.productName +
        " " +
        (product.material || "")
      );

      return {

        ...product,

        searchableText,

        searchableTokens:
          tokenize(searchableText)
      };
    });
  });

/* ================================
   SYNONYMS MAP
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
  hammered: ["mathar"],
  mathar: ["hammer"],

  rice: ["biryani"],
  biryani: ["rice"],

  kansa: ["bronze"],
  bronze: ["kansa"],

  katora: ["waati", "wati", "vaati", "vati"],
  waati: ["katora", "wati", "vaati", "vati"],
  wati: ["katora", "waati", "vaati", "vati"],
  vaati: ["katora", "waati", "wati", "vati"],
  vati: ["katora", "waati", "wati", "vaati"],

  box: ["dabba"],
  dabba: ["box"],

  masala: ["spice"],
  spice: ["masala"],

  kalchul: ["ladle"],
  ladle: ["kalchul"]
};

/* ================================
   EXPAND QUERY
================================ */
function expandQuery(query) {

  const words = tokenize(query);

  let expanded = [...words];

  words.forEach(w => {

    if (synonyms[w]) {
      expanded.push(...synonyms[w]);
    }
  });

  return [...new Set(expanded)];
}

/* ================================
   LEVENSHTEIN DISTANCE
================================ */
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

      if (b.charAt(i - 1) === a.charAt(j - 1)) {

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

/* ================================
   TOKEN MATCH SCORE
================================ */
function tokenScore(queryToken, productToken) {

  /* EXACT */
  if (queryToken === productToken) {
    return 100;
  }

  /* PREFIX */
  if (productToken.startsWith(queryToken)) {
    return 40;
  }

  /* PARTIAL */
  if (productToken.includes(queryToken)) {
    return 25;
  }

  /* VERY SHORT TOKENS */
  if (queryToken.length <= 2) {
    return 0;
  }

  /* LEVENSHTEIN */
  const distance =
    levenshtein(queryToken, productToken);

  if (distance === 1) {
    return 18;
  }

  if (distance === 2 && queryToken.length >= 5) {
    return 10;
  }

  return 0;
}

/* ================================
   SCORING SYSTEM
================================ */
function scoreProduct(product, queryTokens, rawQuery) {

  let score = 0;

  const productTokens =
    product.searchableTokens;

  /* EXACT FULL QUERY */
  if (product.searchableText === rawQuery) {
    score += 500;
  }

  /* FULL PHRASE */
  if (product.searchableText.includes(rawQuery)) {
    score += 120;
  }

  /* TOKEN SCORING */
  queryTokens.forEach(queryToken => {

    let bestTokenScore = 0;

    productTokens.forEach(productToken => {

      const currentScore =
        tokenScore(queryToken, productToken);

      if (currentScore > bestTokenScore) {
        bestTokenScore = currentScore;
      }
    });

    score += bestTokenScore;
  });

  /* MATERIAL BOOST */
  if (
    product.material &&
    queryTokens.includes(
      normalize(product.material)
    )
  ) {
    score += 35;
  }

  return score;
}

/* ================================
   SEARCH ENGINE
================================ */
function searchProducts(query) {

  const clean = normalize(query);

  if (!clean) return [];

  const queryTokens =
    expandQuery(clean);

  let results = products
    .map(product => ({

      product,

      score: scoreProduct(
        product,
        queryTokens,
        clean
      )

    }))
    .filter(result => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(result => result.product);

  /* MATERIAL FILTER */
  if (activeMaterial) {

    results = results.filter(product => {
      return product.material === activeMaterial;
    });
  }

  return results;
}

/* ================================
   TOAST
================================ */
function showToast(message) {

  const toast =
    document.createElement("div");

  toast.className = "toast";
  toast.innerText = message;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 2000);
}

/* ================================
   RESTOCK FUNCTIONS
================================ */
function toggleRestock(id) {

  const el =
    document.getElementById("note-" + id);

  if (!el) return;

  el.style.display =
    el.style.display === "block"
      ? "none"
      : "block";
}

function submitRestock(id) {

  const product =
    products.find(p => p.sr === id);

  if (!product) return;

  const noteInput =
    document.querySelector(`#note-${id} input`);

  const note =
    noteInput
      ? noteInput.value.trim()
      : "";

  const formURL =
    "https://docs.google.com/forms/d/e/1FAIpQLSchgrkyM1HV8N4WCi7IEfNKuhBcZpYxg2RevxKLTDhsZCphAg/formResponse";

  const formData = new FormData();

  formData.append(
    "entry.1915686954",
    product.sr
  );

  formData.append(
    "entry.1591837856",
    product.productName
  );

  formData.append(
    "entry.1545878342",
    note
  );

  fetch(formURL, {
    method: "POST",
    mode: "no-cors",
    body: formData
  });

  document.getElementById(
    "note-" + id
  ).style.display = "none";

  if (noteInput) {
    noteInput.value = "";
  }

  showToast("✓ Restock request sent");
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

  renderResults(lastResults);
});

/* ================================
   MATERIAL FILTER BUTTONS
================================ */
filterButtons.forEach(button => {

  button.addEventListener("click", () => {

    const clickedMaterial =
      button.dataset.material;

    if (activeMaterial === clickedMaterial) {

      activeMaterial = null;

    } else {

      activeMaterial = clickedMaterial;
    }

    filterButtons.forEach(btn => {

      btn.classList.remove(
        "active-brass",
        "active-copper",
        "active-kansa"
      );
    });

    if (activeMaterial === "Brass") {
      button.classList.add("active-brass");
    }

    if (activeMaterial === "Copper") {
      button.classList.add("active-copper");
    }

    if (activeMaterial === "Kansa") {
      button.classList.add("active-kansa");
    }

    const results =
      searchProducts(searchInput.value);

    lastResults = results;

    renderResults(results);
  });
});

/* ================================
   RENDER RESULTS
================================ */
function renderResults(results) {

  if (results.length === 0) {

    resultsDiv.innerHTML = searchInput.value.trim()
      ? `<div class="no-results">No products found</div>`
      : "";
    return;
  }

  let html = "";

  results.forEach(item => {

    let materialClass = "";

    if (item.material === "Brass") {
      materialClass = "material-brass";
    }

    if (item.material === "Copper") {
      materialClass = "material-copper";
    }

    if (item.material === "Kansa") {
      materialClass = "material-kansa";
    }

    const materialBadge =
      item.material
        ? `
          <div class="unit material-badge ${materialClass}">
            ${item.material}
          </div>
        `
        : "";

    html += `

      <div class="product-card">

        <div class="product-title">
          ${item.sr}. ${item.productName}
        </div>

        <div class="price-row">

          ${
            currentMode === "W"

              ? `
                <div class="price-w-full">
                  ${item.wPrice || "-"}
                </div>
              `

              : `
                <div class="price-r-full">
                  ${item.rPrice || "-"}
                </div>
              `
          }

        </div>

        <div class="bottom-row">

          <div
            style="
              display:flex;
              gap:8px;
              align-items:center;
            "
          >

            <div class="unit ${item.priceType === "PP" ? "unit-pp" : ""}">
              ${item.priceType || ""}
            </div>

            ${materialBadge}

          </div>

          <button
            class="restock-btn"
            onclick="toggleRestock(${item.sr})"
          >
            Request Restock
          </button>

        </div>

        <div
          id="note-${item.sr}"
          class="restock-note"
        >

          <input
            placeholder="Optional note (size, qty etc)"
          >

          <button
            onclick="submitRestock(${item.sr})"
          >
            Submit
          </button>

        </div>

      </div>
    `;
  });

  resultsDiv.innerHTML = html;
}

/* ================================
   SEARCH EVENTS
================================ */
searchInput.addEventListener("input", e => {

  const val = e.target.value;

  clearBtn.style.display =
    val
      ? "flex"
      : "none";

  materialFilter.style.display =
    val.trim()
      ? "block"
      : "none";

  const results =
    searchProducts(val);

  lastResults = results;

  renderResults(results);
});

/* ================================
   CLEAR SEARCH
================================ */
clearBtn.addEventListener("click", () => {

  searchInput.value = "";

  clearBtn.style.display = "none";

  materialFilter.style.display = "none";

  activeMaterial = null;

  filterButtons.forEach(btn => {

    btn.classList.remove(
      "active-brass",
      "active-copper",
      "active-kansa"
    );
  });

  lastResults = [];

  renderResults([]);

  searchInput.focus();
});
