function pad(value) {
  return String(value).padStart(2, "0");
}

function formatDateTime(isoString) {
  const date = new Date(isoString);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    " ",
    pad(date.getHours()),
    ":",
    pad(date.getMinutes())
  ].join("");
}

module.exports = {
  formatDateTime
};
