let products = [];
let billItems = [];
let customerType = "";

// ELEMENTS
const btnW = document.getElementById("btnW");
const btnR = document.getElementById("btnR");
const printBtn = document.getElementById("printBtn");
const productSearch = document.getElementById("productSearch");
const searchResults = document.getElementById("searchResults");
const billItemsContainer = document.getElementById("billItems");
const grandTotalEl = document.getElementById("grandTotal");

const billNumber = document.getElementById("billNumber");
const customerName = document.getElementById("customerName");
const billDate = document.getElementById("billDate");
const billNotes = document.getElementById("billNotes");

// AUTO DATE
billDate.valueAsDate = new Date();

// LOAD PRODUCTS
fetch("productList.json")
  .then(r => r.json())
  .then(d => products = d);

// CUSTOMER TYPE
btnW.onclick = () => setType("W");
btnR.onclick = () => setType("R");

function setType(t) {
  customerType = t;
  btnW.classList.toggle("active", t === "W");
  btnR.classList.toggle("active", t === "R");
  productSearch.disabled = false;
  productSearch.focus();
}

// SEARCH
productSearch.oninput = () => {
  const q = productSearch.value.toLowerCase();
  searchResults.innerHTML = "";
  if (!q) return;

  products
    .filter(p => p.productName.toLowerCase().includes(q))
    .slice(0, 10)
    .forEach(p => {
      const d = document.createElement("div");
      d.textContent = p.productName;
      d.className = "search-item";
      d.onclick = () => addItem(p);
      searchResults.appendChild(d);
    });
};

// ADD ITEM
function addItem(p) {
  billItems.push({
    product: p,
    price: customerType === "W" ? p.wPrice : p.rPrice,
    qty: "",
    total: 0
  });

  productSearch.value = "";
  searchResults.innerHTML = "";
  render();
}

// RENDER BILL (ONLY ADD / DELETE)
function render() {
  billItemsContainer.innerHTML = "";

  billItems.forEach((i, idx) => {
    const row = document.createElement("div");
    row.className = "bill-row";

    const isKg = i.product.priceType === "KG";

    row.innerHTML = `
      <div class="bill-row-header">${i.product.productName}</div>

      <div class="bill-inputs">
        <input 
          type="number"
          placeholder="Price" 
          value="${i.price}"
        />

        <input 
          type="text"
          placeholder="${isKg ? "Kg" : "Qty"}"
          inputmode="${isKg ? "decimal" : "numeric"}"
          pattern="${isKg ? "[0-9]*[.,]?[0-9]*" : "[0-9]*"}"
          value="${i.qty}"
        />
      </div>

      <div class="line-total">${i.total}</div>
      <button class="delete-btn">✕</button>
    `;

    const priceInput = row.querySelectorAll("input")[0];
    const qtyInput = row.querySelectorAll("input")[1];
    const lineTotalEl = row.querySelector(".line-total");

    priceInput.oninput = e => {
      i.price = parseFloat(e.target.value) || 0;
      updateLine(i, lineTotalEl);
    };

    qtyInput.oninput = e => {
      const raw = e.target.value.replace(",", ".");
      i.qty = raw;
      updateLine(i, lineTotalEl);
    };

    row.querySelector("button").onclick = () => {
      billItems.splice(idx, 1);
      render();
    };

    billItemsContainer.appendChild(row);
  });

  updateTotal();
}

// UPDATE LINE
function updateLine(i, lineTotalEl) {
  const price = parseFloat(i.price) || 0;
  const qty = parseFloat(i.qty) || 0;

  i.total = Math.round(price * qty);
  lineTotalEl.textContent = i.total;

  updateTotal();
}

// UPDATE GRAND TOTAL
function updateTotal() {
  const total = billItems.reduce((s, i) => s + i.total, 0);
  grandTotalEl.textContent = total;
}

// ================= PRINT / PDF (NEW PROFESSIONAL FORMAT) =================

printBtn.onclick = () => {
  const inv = document.getElementById("printInvoice");

  const billNo = billNumber.value || "";
  const cust = customerName.value || "";
  const date = billDate.value;
  const notes = billNotes.value;

  let rows = billItems.map((i, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td>${i.product.productName}</td>
      <td class="num">${i.price}</td>
      <td class="num">${i.qty}</td>
      <td class="num">${i.total}</td>
    </tr>
  `).join("");

  inv.innerHTML = `
    <div class="invoice-title">Your Business Name</div>

    <div class="invoice-header-line">
      Bill No: ${billNo} &nbsp;&nbsp; | &nbsp;&nbsp;
      Customer: ${cust} &nbsp;&nbsp; | &nbsp;&nbsp;
      Date: ${date}
    </div>

    <table>
      <tr>
        <th>Sr.</th>
        <th>Item</th>
        <th class="num">Rate</th>
        <th class="num">Qty</th>
        <th class="num">Amount</th>
      </tr>
      ${rows}
    </table>

    <div class="invoice-total">
      Total: ${grandTotalEl.textContent}
    </div>

    ${notes ? `<div class="invoice-notes">Notes: ${notes}</div>` : ""}
  `;

  window.print();
};
