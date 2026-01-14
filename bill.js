let products = [];
let selectedCustomerType = null;
let billItems = [];

// ELEMENTS
const btnW = document.getElementById("btnW");
const btnR = document.getElementById("btnR");
const productSearch = document.getElementById("productSearch");
const searchResults = document.getElementById("searchResults");
const billItemsContainer = document.getElementById("billItems");
const grandTotalEl = document.getElementById("grandTotal");

// LOAD PRODUCTS
fetch("productList.json")
  .then(res => res.json())
  .then(data => products = data);

// CUSTOMER TYPE
btnW.onclick = () => setCustomerType("W");
btnR.onclick = () => setCustomerType("R");

function setCustomerType(type) {
  selectedCustomerType = type;

  btnW.classList.toggle("active", type === "W");
  btnR.classList.toggle("active", type === "R");

  productSearch.disabled = false;
  productSearch.focus();

  billItems.forEach(item => {
    item.price = getDefaultPrice(item.product);
    calculateLineTotal(item);
  });

  renderBill();
}

// SEARCH
productSearch.addEventListener("input", () => {
  const q = productSearch.value.toLowerCase().trim();
  searchResults.innerHTML = "";
  if (!q) return;

  products
    .filter(p => p.productName.toLowerCase().includes(q))
    .slice(0, 15)
    .forEach(product => {
      const div = document.createElement("div");
      div.className = "search-item";
      div.textContent = product.productName;
      div.onclick = () => {
        addProduct(product);
        productSearch.value = "";
        searchResults.innerHTML = "";
        productSearch.focus();
      };
      searchResults.appendChild(div);
    });
});

// ADD PRODUCT
function addProduct(product) {
  const item = {
    id: Date.now() + Math.random(),
    product,
    price: getDefaultPrice(product),
    quantity: "",
    lineTotal: 0
  };

  billItems.push(item);
  renderBill();
}

// PRICE BY TYPE
function getDefaultPrice(product) {
  return selectedCustomerType === "W" ? product.wPrice : product.rPrice;
}

// CALCULATION
function calculateLineTotal(item) {
  const price = parseFloat(item.price) || 0;
  const qty = parseFloat(item.quantity) || 0;
  item.lineTotal = Math.round(price * qty);
}

// RENDER
function renderBill() {
  billItemsContainer.innerHTML = "";

  billItems.forEach(item => {
    const row = document.createElement("div");
    row.className = "bill-row";

    const title = document.createElement("div");
    title.className = "bill-row-header";
    title.textContent = item.product.productName;
    row.appendChild(title);

    const inputs = document.createElement("div");
    inputs.className = "bill-inputs";

    // PRICE
    const priceInput = document.createElement("input");
    priceInput.type = "number";
    priceInput.placeholder = "Price";
    priceInput.value = item.price ?? "";
    priceInput.oninput = () => {
      item.price = priceInput.value;
      calculateLineTotal(item);
      updateTotals();
      totalEl.textContent = item.lineTotal;
    };
    inputs.appendChild(priceInput);

    // QUANTITY (KG or PP)
    const qtyInput = document.createElement("input");
    qtyInput.type = "number";
    qtyInput.placeholder = item.product.priceType === "KG" ? "Kg" : "Qty";
    qtyInput.step = item.product.priceType === "KG" ? "0.01" : "1";
    qtyInput.value = item.quantity;
    qtyInput.oninput = () => {
      item.quantity = qtyInput.value;
      calculateLineTotal(item);
      updateTotals();
      totalEl.textContent = item.lineTotal;
    };
    inputs.appendChild(qtyInput);

    row.appendChild(inputs);

    const totalEl = document.createElement("div");
    totalEl.className = "line-total";
    totalEl.textContent = item.lineTotal;
    row.appendChild(totalEl);

    const del = document.createElement("button");
    del.className = "delete-btn";
    del.textContent = "✕";
    del.onclick = () => {
      billItems = billItems.filter(b => b.id !== item.id);
      renderBill();
    };
    row.appendChild(del);

    billItemsContainer.appendChild(row);
  });

  updateTotals();
}

// TOTAL
function updateTotals() {
  grandTotalEl.textContent = billItems.reduce((s, i) => s + i.lineTotal, 0);
}

// CLOSE SEARCH
document.addEventListener("click", e => {
  if (!e.target.closest(".search-section")) searchResults.innerHTML = "";
});
