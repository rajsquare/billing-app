let products = [];
let selectedCustomerType = null; // "W" or "R"
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
  .then(data => {
    products = data;
  });

// CUSTOMER TYPE SELECTION
btnW.addEventListener("click", () => setCustomerType("W"));
btnR.addEventListener("click", () => setCustomerType("R"));

function setCustomerType(type) {
  selectedCustomerType = type;

  btnW.classList.remove("active");
  btnR.classList.remove("active");

  if (type === "W") btnW.classList.add("active");
  if (type === "R") btnR.classList.add("active");

  productSearch.disabled = false;
  productSearch.focus();

  // Reprice existing items
  billItems.forEach(item => {
    item.price = getDefaultPrice(item.product);
    calculateLineTotal(item);
  });

  renderBill();
}

// SEARCH LOGIC
productSearch.addEventListener("input", () => {
  const query = productSearch.value.toLowerCase().trim();
  searchResults.innerHTML = "";

  if (!query) return;

  const matches = products
    .filter(p => p.productName.toLowerCase().includes(query))
    .slice(0, 15);

  matches.forEach(product => {
    const div = document.createElement("div");
    div.className = "search-item";
    div.textContent = product.productName;

    div.addEventListener("click", () => {
      addProductToBill(product);
      productSearch.value = "";
      searchResults.innerHTML = "";
      productSearch.focus();
    });

    searchResults.appendChild(div);
  });
});

// ADD PRODUCT
function addProductToBill(product) {
  if (!selectedCustomerType) return;

  const item = {
    id: Date.now() + Math.random(),
    product,
    price: getDefaultPrice(product),
    quantity: product.priceType === "KG" ? 1 : 1,
    lineTotal: 0
  };

  calculateLineTotal(item);
  billItems.push(item);
  renderBill();
}

// PRICE BASED ON CUSTOMER TYPE
function getDefaultPrice(product) {
  return selectedCustomerType === "W"
    ? product.wPrice
    : product.rPrice;
}

// CALCULATE LINE TOTAL
function calculateLineTotal(item) {
  if (item.product.priceType === "KG") {
    const qty = parseFloat(item.quantity) || 0;
    item.lineTotal = Math.round(qty * (item.price || 0));
  } else {
    item.lineTotal = Math.round(item.price || 0);
  }
}

// RENDER BILL
function renderBill() {
  billItemsContainer.innerHTML = "";

  billItems.forEach(item => {
    const row = document.createElement("div");
    row.className = "bill-row";

    // HEADER
    const header = document.createElement("div");
    header.className = "bill-row-header";
    header.textContent = item.product.productName;
    row.appendChild(header);

    // INPUTS
    const inputs = document.createElement("div");
    inputs.className = "bill-inputs";

    // PRICE INPUT
    const priceInput = document.createElement("input");
    priceInput.type = "number";
    priceInput.value = item.price ?? "";
    priceInput.placeholder = "Price";
    priceInput.addEventListener("input", () => {
      item.price = parseFloat(priceInput.value) || 0;
      calculateLineTotal(item);
      updateTotals();
      lineTotalEl.textContent = item.lineTotal;
    });
    inputs.appendChild(priceInput);

    // QUANTITY INPUT (KG ONLY)
    if (item.product.priceType === "KG") {
      const qtyInput = document.createElement("input");
      qtyInput.type = "number";
      qtyInput.step = "0.01";
      qtyInput.value = item.quantity;
      qtyInput.placeholder = "Kg";
      qtyInput.addEventListener("input", () => {
        item.quantity = parseFloat(qtyInput.value) || 0;
        calculateLineTotal(item);
        updateTotals();
        lineTotalEl.textContent = item.lineTotal;
      });
      inputs.appendChild(qtyInput);
    }

    row.appendChild(inputs);

    // LINE TOTAL
    const lineTotalEl = document.createElement("div");
    lineTotalEl.className = "line-total";
    lineTotalEl.textContent = item.lineTotal;
    row.appendChild(lineTotalEl);

    // DELETE BUTTON
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-btn";
    deleteBtn.textContent = "✕";
    deleteBtn.addEventListener("click", () => {
      billItems = billItems.filter(b => b.id !== item.id);
      renderBill();
    });
    row.appendChild(deleteBtn);

    billItemsContainer.appendChild(row);
  });

  updateTotals();
}

// UPDATE GRAND TOTAL
function updateTotals() {
  const total = billItems.reduce((sum, item) => sum + item.lineTotal, 0);
  grandTotalEl.textContent = Math.round(total);
}

// CLOSE SEARCH ON OUTSIDE TAP
document.addEventListener("click", e => {
  if (!e.target.closest(".search-section")) {
    searchResults.innerHTML = "";
  }
});
