const fs = require("fs");
const path = require("path");
const Parser = require("rss-parser");
const RSS = require("rss");

// ----------------------------
// CONFIG
// ----------------------------

const ORGANISATIONS_CSV_URL =
  "https://raw.githubusercontent.com/deelion/folkestone-hythe-community-directory/data/organisations.csv";

const SITE_URL = "https://folke.world";
const OUTPUT_PATH = path.join(__dirname, "../public/feed.xml");
const MAX_ITEMS = 100;

// ----------------------------
// MAIN
// ----------------------------

async function generateFeed() {
  console.log("Generating community RSS feed…");

  const parser = new Parser({
    headers: {
      "User-Agent":
        "CommunityFeedBot/1.0 (+https://github.com/deelion/folkestone-hythe-community-feed)",
    },
    customFields: {
      item: ["content:encoded"],
    },
  });

  console.log("Fetching organisations CSV…");
  const orgCSV = await fetch(ORGANISATIONS_CSV_URL).then((res) => {
    if (!res.ok) {
      throw new Error(`Failed to fetch CSV: ${res.status}`);
    }
    return res.text();
  });

  const organisations = parseCSV(orgCSV);

  const rssSources = organisations
    .filter((org) => org["RSS Feed"])
    .map((org) => ({
      name: org["Organisation"],
      rssUrl: org["RSS Feed"],
    }));

  console.log(`Fetching ${rssSources.length} RSS feeds…`);

  const items = [];

  for (const source of rssSources) {
    try {
      const feed = await parser.parseURL(source.rssUrl);
      const feedItems = feed.items.slice(0, 5);

      feedItems.forEach((item) => {
        items.push({
          title: item.title,
          link: item.link,
          date: item.isoDate || item.pubDate,
          description:
            item["content:encoded"] ||
            item.contentSnippet ||
            item.content ||
            "",
          organisation: source.name,
        });
      });
    } catch (err) {
      console.warn(`RSS failed: ${source.rssUrl}`);
      console.warn(err.message);
    }
  }

  items.sort((a, b) => new Date(b.date) - new Date(a.date));
  const latestItems = items.slice(0, MAX_ITEMS);

  console.log(`Building RSS feed (${latestItems.length} items)…`);

  const feed = new RSS({
    title: "Local Community Updates",
    description: "Updates from local community organisations",
    site_url: SITE_URL,
    feed_url: SITE_URL + "/feed.xml",
    language: "en",
  });

  latestItems.forEach((item) => {
    feed.item({
      title: item.title,
      description: truncateText(stripImages(item.description)),
      url: item.link,
      guid: item.link,
      date: item.date,
    });
  });

  const xml = feed.xml({ indent: true });

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, xml, "utf8");

  console.log(`Feed written to ${OUTPUT_PATH}`);
}

// ----------------------------
// HELPERS
// ----------------------------

function parseCSV(text) {
  const rows = [];
  let currentRow = [];
  let currentValue = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"' && nextChar === '"') {
      currentValue += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      currentRow.push(currentValue);
      currentValue = "";
    } else if (char === "\n" && !inQuotes) {
      currentRow.push(currentValue);
      rows.push(currentRow);
      currentRow = [];
      currentValue = "";
    } else {
      currentValue += char;
    }
  }

  currentRow.push(currentValue);
  rows.push(currentRow);

  const headers = rows[0].map((h) => h.trim());

  return rows.slice(1).map((row) => {
    const obj = {};
    headers.forEach((header, i) => {
      obj[header] = row[i]?.trim() || "";
    });
    return obj;
  });
}

function stripImages(html) {
  return html.replace(/<img[^>]*>/g, "");
}

function truncateText(text, maxLength = 300) {
  if (!text) return "";
  return text.length > maxLength ? text.slice(0, maxLength) + "…" : text;
}

// ----------------------------
// RUN
// ----------------------------

generateFeed().catch((err) => {
  console.error("Feed generation failed");
  console.error(err);
  process.exit(1);
});
