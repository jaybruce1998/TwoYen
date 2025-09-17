async function fetchHtml(url) {
  const resp = await chrome.runtime.sendMessage({ type: "fetchHtml", url });
  if (resp.error) throw new Error(resp.error);
  return resp.html;
}

async function fetchDoc(url) {
  const html = await fetchHtml(url);
  return new DOMParser().parseFromString(html, "text/html");
}

async function fetchSellerFromDp(url) {
  const html = await fetchHtml(url);
  const m = html.match(/<a [^>]*id=["']sellerProfileTriggerId["'][^>]*>([\s\S]*?)<\/a>/i);
  return m ? m[1].trim() : null;
}

async function processAsin(asin) {
  const dpUrl = `https://www.amazon.com/dp/${asin}`;
  const seller = await fetchSellerFromDp(dpUrl);

  if (seller === "wals01") {
    return "😇";
  }

  const aodUrl =
    `https://www.amazon.com/gp/product/ajax/aodAjaxMain/ref=aod_f_new?asin=${asin}&pc=dp&pageno=1&filters=%257B%2522all%2522%253Atrue%252C%2522primeEligible%2522%253Atrue%252C%2522new%2522%253Atrue%257D&isonlyrenderofferlist=true`;

  const aodDoc = await fetchDoc(aodUrl);
  const blocks = [...aodDoc.getElementsByClassName("aod-information-block")];

  if (blocks.length === 0) return "😈";

  const parsed = blocks.map(v => {
    const priceEl = v.querySelector("#aod-offer-price .aok-offscreen");
    const soldByEl = v.querySelectorAll("#aod-offer-soldBy span, #aod-offer-soldBy a")[1];
    if (!priceEl || !soldByEl) return null;
    const price = +priceEl.textContent.trim().split(" ")[0].replace(/\$/g, "");
    const soldBy = soldByEl.textContent.trim();
    return [price, soldBy];
  }).filter(e => e && e[1] !== "Amazon.com");

  if (parsed.length === 0) return "😈";
  const best = parsed.sort((a, b) => a[0] - b[0])[0];
  return best[1] === "wals01"
    ? "👺"
    : `$${best[0].toFixed(2)}, Sold by ${best[1]}`;
}

// Retry wrapper with exponential backoff
async function withRetry(fn, retries = 3, delay = 1000) {
  try {
    return await fn();
  } catch (err) {
    if (retries <= 0) throw err;
    await new Promise(res => setTimeout(res, delay));
    return withRetry(fn, retries - 1, delay * 2);
  }
}

// Concurrency-limited runner
async function runWithConcurrency(asins, limit, worker) {
  const results = {};
  let i = 0;

  async function next() {
    if (i >= asins.length) return;
    const asin = asins[i++];
    try {
      results[asin] = await withRetry(() => worker(asin));
    } catch (e) {
      results[asin] = "❌ Error";
    }
    return next();
  }

  await Promise.all(Array.from({ length: limit }, next));
  return results;
}

// Entry point
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "runScraper") {
    const asins = [...document.getElementsByTagName("span")]
      .map(e => e.innerText)
      .filter(e => e.length === 10 && e.indexOf(" ") < 0);

    const divs = document.querySelectorAll("[data-test-id='FeaturedOfferPrice']");

    const statusDiv = document.querySelector("[data-test-id]");
    if (!statusDiv) return;

    statusDiv.style.color = "green";
    statusDiv.style.fontSize = "24px";
    statusDiv.style.fontWeight = "bold";
    statusDiv.textContent = "Processing ASINs";

    (async () => {
      const limit = 3; // concurrency level
      let processed = 0;

      const results = await runWithConcurrency(asins, limit, async (asin) => {
        const result = await processAsin(asin);
        processed++;
        return result;
      });

      statusDiv.textContent = `✅ Finished processing ${processed} ASINs`;

      // Write prices into the table
      asins.forEach((asin, i) => {
        if (divs[i]) {
          divs[i].style.color = "green";
          divs[i].style.fontSize = "20px";
          divs[i].style.fontWeight = "bold";
          divs[i].textContent = results[asin];
        }
      });
    })();
  }
});
