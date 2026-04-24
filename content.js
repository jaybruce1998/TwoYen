async function fetchHtml(url) {
	const resp = await chrome.runtime.sendMessage({ type: "fetchHtml", url });
	if (resp.error)
		throw new Error(resp.error);
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

	if (seller === 'wals01') {
		return ['😇'];
	}

	const aodUrl =
`https://www.amazon.com/gp/product/ajax/aodAjaxMain/ref=aod_f_new?asin=${asin}&pc=dp&pageno=1&filters=%257B%2522all%2522%253Atrue%252C%2522primeEligible%2522%253Atrue%252C%2522new%2522%253Atrue%257D&isonlyrenderofferlist=true`;

	const aodDoc = await fetchDoc(aodUrl);
	const blocks = [...aodDoc.getElementsByClassName("aod-information-block")];

	const parsed = blocks.map(v => {
		const priceEl = v.querySelector("#aod-offer-price .aok-offscreen");
		const soldByEl = v.querySelectorAll("#aod-offer-soldBy span, #aod-offer-soldBy a")[1];
		if (!priceEl || !soldByEl)
			return null;
		const price = +priceEl.textContent.trim().split(" ")[0].replace(/\$/g, "");
		const soldBy = soldByEl.textContent.trim();
		return [price, soldBy];
	}).filter(e => e && e[1] !== "Amazon.com");

	if(parsed.filter(e => e[1] === 'wals01').length==0)
		return ['🍌'];
	const best = parsed.sort((a, b) => a[0] - b[0])[0];
	return [Math.max(10.99, best[0]).toFixed(2), best[1]];
}

// Retry wrapper with exponential backoff
async function withRetry(fn, retries = 3, delay = 1000) {
	try {
		return await fn();
	} catch (err) {
		if (retries <= 0)
			throw err;
		await new Promise(res => setTimeout(res, delay));
		return withRetry(fn, retries - 1, delay * 2);
	}
}

// Concurrency-limited runner
async function runWithConcurrency(asins, limit, worker) {
	const results = {};
	let i = 0;

	async function next() {
		if (i >= asins.length)
			return;
		const asin = asins[i++];
		try {
			results[asin] = await withRetry(() => worker(asin));
		} catch (e) {
			results[asin] = ['❌'];
		}
		return next();
	}

	await Promise.all(Array.from({ length: limit }, next));
	return results;
}

async function typeLikeUser(el, text) {
	el.focus();
	el.value = "";

	for (const char of text) {
		el.dispatchEvent(new KeyboardEvent("keydown", { key: char, bubbles: true }));
		el.value += char;
		el.dispatchEvent(new Event("input", { bubbles: true }));
		el.dispatchEvent(new KeyboardEvent("keyup", { key: char, bubbles: true }));
	}

	el.dispatchEvent(new Event("change", { bubbles: true }));
}

const delay = 1000;
async function scrollUntilStable(expectedNum) {
	while (document.querySelectorAll("[data-sku]").length < expectedNum) {
		window.scrollTo(0, document.body.scrollHeight);
		await new Promise(r => setTimeout(r, delay));
	}
	window.scrollTo(0, document.body.scrollHeight);
	await new Promise(r => setTimeout(r, delay));
}

// Entry point
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
	if (msg.type !== "runScraper")
		return;
	const statusDiv = document.querySelector("[data-test-id]");
	if (!statusDiv)
	{
		alert("Why did you summon me mommigail...");
		return;
	}
	const numArr = document.body.innerHTML.match(/\d,?\d* - \d,?\d* of/g);
	if(!numArr || numArr.length!=1)
	{
		alert("How far do I scroll... get Jay to fix it!");
		return;
	}
	const nums = numArr[0].replace(/,/g, "").split(" ");
	
	(async () => {
		await scrollUntilStable(nums[2]-nums[0]+1);
		window.scrollTo(0, 0);
		statusDiv.style.color = "green";
		statusDiv.style.fontSize = "24px";
		statusDiv.style.fontWeight = "bold";
		statusDiv.textContent = "Processing ASINs";

		const asins = [];
		const messageDivs = {};
		const inputs = {};
		[...document.querySelectorAll("[data-sku]")].forEach(d => {
			const asin=d.querySelector("a").href.split("/")[4];
			asins.push(asin);
			messageDivs[asin]=d.querySelector(".estimated-fees-cell");
			inputs[asin]=d.querySelector("kat-input").shadowRoot.querySelector("input");
		});

		const limit = 3; // concurrency level
		let processed = 0;

		const results = await runWithConcurrency(asins, limit, async (asin) => {
			const result = await processAsin(asin);
			processed++;
			return result;
		});

		// Write prices into the table
		asins.forEach(asin => {
			const newDiv = messageDivs[asin];
			newDiv.style.fontSize = "20px";
			if(results[asin].length==1)
				newDiv.textContent = results[asin][0];
			else
			{
				const old = inputs[asin].value;
				const np = results[asin][0];
				newDiv.style.color = "green";
				newDiv.style.fontSize = "20px";
				newDiv.style.fontWeight = "bold";
				if(old===np)
					newDiv.textContent = '😈';
				else
				{
					typeLikeUser(inputs[asin], np);
					newDiv.onclick=()=>{
						typeLikeUser(inputs[asin], old);
						newDiv.textContent = '😱';
					}
					newDiv.textContent = `Originally $${old}, matched ${results[asin][1]}'s price!`;
				}
			}
		});

		statusDiv.textContent = `✅ Finished processing ${processed} ASINs`;
	})();
});
