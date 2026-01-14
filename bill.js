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
const billDateInput = document.getElementById("billDate");

// AUTO SET TODAY DATE (editable)
if (billDateInput) {
  billDateInput.valueAsDate = new Date();
}

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

  btnW.classList.toggle("active", type === "W");
  btnR.classList.toggle("active", type === "R");

  productSearch.disabled = false;
  productSearch.focus();

  // Reprice existing items if any
  billItems.forEach(item => {
    item.price = getDefaultPrice(item.product);
    calculateLineTotal(item);
  });

  renderBill();
}

// SEARCH PRODUCTS
productSearch.addEventListener("input", () => {
  const query = productSearch.value.toLowerCase().trim();
  searchResults.innerHTML = "";

  if (!query) return;

  products
    .filter(p => p.productName.toLowerCase().includes(query))
    .slice(0, 15)
    .forEach(product => {
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

// ADD PRODUCT TO BILL
function addProductToBill(product) {
  if (!selectedCustomerType) return;

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

// GET PRICE BASED ON CUSTOMER TYPE
function getDefaultPrice(product) {
  return selectedCustomerType === "W"
    ? product.wPrice
    : product.rPrice;
}

// CALCULATE LINE TOTAL
function calculateLineTotal(item) {
  const price = parseFloat(item.price) || 0;
  const qty = parseFloat(item.quantity) || 0;

  item.lineTotal = Math.round(price * qty);
}

// RENDER BILL
function renderBill() {
  billItemsContainer.innerHTML = "";

  billItems.forEach(item => {
    const row = document.createElement("div");
    row.className = "bill-row";

    // PRODUCT NAME
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
    priceInput.placeholder = "Price";
    priceInput.value = item.price ?? "";
    priceInput.addEventListener("input", () => {
      item.price = priceInput.value;
      calculateLineTotal(item);
      updateTotals();
      lineTotalEl.textContent = item.lineTotal;
    });
    inputs.appendChild(priceInput);

    // QUANTITY INPUT (KG or PP)
    const qtyInput = document.createElement("input");
    qtyInput.type = "number";
    qtyInput.placeholder = item.product.priceType === "KG" ? "Kg" : "Qty";
    qtyInput.step = item.product.priceType === "KG" ? "0.01" : "1";
    qtyInput.value = item.quantity;
    qtyInput.addEventListener("input", () => {
      item.quantity = qtyInput.value;
      calculateLineTotal(item);
      updateTotals();
      lineTotalEl.textContent = item.lineTotal;
    });
    inputs.appendChild(qtyInput);

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

// CLOSE SEARCH RESULTS ON OUTSIDE TAP
document.addEventListener("click", e => {
  if (!e.target.closest(".search-section")) {
    searchResults.innerHTML = "";
  }
});
