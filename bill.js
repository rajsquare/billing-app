* {
  box-sizing: border-box;
  -webkit-tap-highlight-color: transparent;
}

html, body {
  margin: 0;
  padding: 0;
  overflow-x: hidden; /* HARD LOCK horizontal scroll */
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
  background: #f4f4f4;
  color: #222;
}

/* TOP BAR */
.customer-type {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 8px;
  padding: 8px;
  background: #fff;
  position: sticky;
  top: 0;
  z-index: 10;
}

.type-btn {
  padding: 10px 0;
  font-size: 16px;
  font-weight: 600;
  border-radius: 8px;
  border: 2px solid #ddd;
  background: #fafafa;
}

.type-btn.active {
  background: #111;
  color: #fff;
  border-color: #111;
}

.print-btn {
  padding: 10px 12px;
  font-size: 14px;
  border-radius: 8px;
  border: 1px solid #ccc;
  background: #eee;
}

/* HEADER */
.bill-header.compact {
  display: grid;
  grid-template-columns: 70px 1fr 120px;
  gap: 8px;
  padding: 8px;
  background: #fff;
  border-bottom: 1px solid #e0e0e0;
}

.bill-header.compact input {
  padding: 8px;
  font-size: 14px;
  border-radius: 6px;
  border: 1px solid #ccc;
}

/* SEARCH */
.search-section {
  padding: 10px;
  background: #fff;
}

#productSearch {
  width: 100%;
  padding: 14px;
  font-size: 16px;
  border-radius: 8px;
  border: 1px solid #bbb;
}

.search-results {
  margin-top: 8px;
  background: #fff;
  border-radius: 8px;
  max-height: 260px;
  overflow-y: auto;
}

/* BILL */
.bill-items {
  padding: 10px;
  padding-bottom: 150px;
}

.bill-row {
  background: #fff;
  border-radius: 10px;
  padding: 12px;
  margin-bottom: 12px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.06);
  position: relative;
}

.bill-row-header {
  font-weight: 600;
  margin-bottom: 8px;
}

.bill-inputs {
  display: flex;
  gap: 8px;
}

.bill-inputs input {
  flex: 1;
  padding: 10px;
  border-radius: 6px;
  border: 1px solid #ccc;
}

.line-total {
  margin-top: 8px;
  font-weight: 600;
  text-align: right;
}

.delete-btn {
  position: absolute;
  top: 10px;
  right: 10px;
  background: none;
  border: none;
  color: #c00;
}

/* NOTES */
.notes-section {
  padding: 10px;
  background: #fff;
}

.notes-section textarea {
  width: 100%;
  padding: 10px;
  border-radius: 8px;
  border: 1px solid #ccc;
}

/* TOTAL */
.total-section {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: #111;
  color: #fff;
  padding: 14px;
  display: flex;
  justify-content: space-between;
}

/* PRINT STYLES */
@media print {
  body {
    background: #fff;
  }

  .customer-type,
  .search-section,
  .delete-btn,
  .print-btn {
    display: none !important;
  }

  .bill-row {
    box-shadow: none;
    border-bottom: 1px solid #ccc;
    border-radius: 0;
  }

  .total-section {
    position: static;
    color: #000;
    background: none;
    border-top: 2px solid #000;
    margin-top: 10px;
  }

  textarea {
    border: none;
  }
}
