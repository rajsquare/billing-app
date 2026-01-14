let products = [];
let selectedCustomerType = null;
let billItems = [];

const btnW = document.getElementById("btnW");
const btnR = document.getElementById("btnR");
const printBtn = document.getElementById("printBtn");
const productSearch = document.getElementById("productSearch");
const searchResults = document.getElementById("searchResults");
const billItemsContainer = document.getElementById("billItems");
const grandTotalEl = document.getElementById("grandTotal");
const billDateInput = document.getElementById("billDate");

billDateInput.valueAsDate = new Date();

fetch("productList.json")
  .then(r => r.json())
  .then(d => products = d);

btnW.onclick = () => setCustomerType("W");
btnR.onclick = () => setCustomerType("R");

function setCustomerType(t) {
  selectedCustomerType = t;
  btnW.classList.toggle("active", t === "W");
  btnR.classList.toggle("active", t === "R");
  productSearch.disabled = false;
}

productSearch.oninput = () => {
  const q = productSearch.value.toLowerCase();
  searchResults.innerHTML = "";
  if (!q) return;

  products.filter(p => p.productName.toLowerCase().includes(q)).slice(0, 10)
    .forEach(p => {
      const d = document.createElement("div");
      d.textContent = p.productName;
      d.onclick = () => {
        billItems.push({
          product: p,
          price: selectedCustomerType === "W" ? p.wPrice : p.rPrice,
          quantity: "",
          lineTotal: 0
        });
        productSearch.value = "";
        render();
      };
      searchResults.appendChild(d);
    });
};

function render() {
  billItemsContainer.innerHTML = "";
  billItems.forEach((i, idx) => {
    const d = document.createElement("div");
    d.innerHTML = `
      <strong>${i.product.productName}</strong><br>
      <input placeholder="Price" value="${i.price}">
      <input placeholder="Qty" value="${i.quantity}">
      <div>${i.lineTotal}</div>
      <button>✕</button>
    `;
    d.querySelectorAll("input")[0].oninput = e => {
      i.price = +e.target.value || 0;
      calc(i);
    };
    d.querySelectorAll("input")[1].oninput = e => {
      i.quantity = +e.target.value || 0;
      calc(i);
    };
    d.querySelector("button").onclick = () => {
      billItems.splice(idx, 1);
      render();
    };
    billItemsContainer.appendChild(d);
  });
  updateTotal();
}

function calc(i) {
  i.lineTotal = Math.round((i.price || 0) * (i.quantity || 0));
  render();
}

function updateTotal() {
  grandTotalEl.textContent = billItems.reduce((s, i) => s + i.lineTotal, 0);
}

printBtn.onclick = () => {
  const invoice = document.getElementById("printInvoice");

  const billNo = document.getElementById("billNumber").value || "";
  const cust = document.getElementById("customerName").value || "";
  const date = document.getElementById("billDate").value;
  const notes = document.getElementById("billNotes").value;

  let rows = billItems.map(i => `
    <tr>
      <td>${i.product.productName}</td>
      <td class="num">${i.price}</td>
      <td class="num">${i.quantity}</td>
      <td class="num">${i.lineTotal}</td>
    </tr>
  `).join("");

  invoice.innerHTML = `
    <div class="invoice-header">
      <h2>Your Business Name</h2>
    </div>

    <div class="invoice-meta">
      <div>
        Bill #: ${billNo}<br>
        Customer: ${cust}<br>
        Type: ${selectedCustomerType}
      </div>
      <div>
        Date: ${date}
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th>Rate</th>
          <th>Qty</th>
          <th>Amount</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="invoice-total">
      TOTAL: ${grandTotalEl.textContent}
    </div>

    ${notes ? `<div class="invoice-notes">Notes: ${notes}</div>` : ""}
  `;

  window.print();
};
