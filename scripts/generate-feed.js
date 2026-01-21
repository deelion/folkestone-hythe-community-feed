const fs = require("fs");
const path = require("path");
const Parser = require("rss-parser");
const RSS = require("rss");

// ----------------------------
// CONFIG
// ----------------------------

const ORGANISATIONS_CSV_URL =
  "https://raw.githubusercontent.com/deelion/folkestone-hythe-community-directory/refs/heads/main/data/organisations.csv";

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
        "Mozilla/5.0 (compatible; CommunityFeedBot/1.0; +https://github.com/deelion/folkestone-hythe-community-feed)",
      Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
      "Accept-Language": "en-GB,en;q=0.9",
      Connection: "keep-alive",
    },
    customFields: {
      item: ["content:encoded"],
    },
    requestOptions: {
      followRedirects: true,
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
      const feedItems = feed.items.slice(0, 20);

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
    } catch (rssErr) {
      console.warn(`RSS failed: ${source.rssUrl}`);

      if (isSubstackUrl(source.rssUrl)) {
        try {
          console.log(`Falling back to Substack JSON`);
          const substackItems = await fetchSubstackPosts(
            source.rssUrl,
            source.name,
          );
          items.push(...substackItems);
        } catch (jsonErr) {
          console.warn(`Substack JSON failed: ${source.rssUrl}`);
          console.warn(jsonErr.message);
        }
      } else {
        console.warn(rssErr.message);
      }
    }
  }

  await sleep(500);

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
      description: plainText(item.description),
      url: item.link,
      guid: item.link,
      date: item.date,
      custom_elements: [{ organisation: item.organisation }],
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

function isSubstackUrl(url) {
  try {
    const { hostname } = new URL(url);
    return hostname === "substack.com" || hostname.endsWith(".substack.com");
  } catch {
    return false;
  }
}

function getSubstackJsonUrl(rssUrl) {
  const url = new URL(rssUrl);

  // strip paths like /feed, /archive, etc.
  url.pathname = "";

  return `${url.origin}/api/v1/posts`;
}

async function fetchSubstackPosts(rssUrl, organisation) {
  const head = await fetch(rssUrl, {
    method: "HEAD",
    redirect: "follow",
  });

  const finalUrl = head.url;
  const url = new URL(finalUrl);
  const jsonUrl = `${url.origin}/api/v1/posts`;

  const res = await fetch(jsonUrl, {
    headers: {
      "User-Agent": "CommunityFeedBot/1.0",
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`Substack JSON failed: ${res.status}`);
  }

  const posts = await res.json();

  return posts.slice(0, 20).map((post) => ({
    title: post.title,
    link: post.canonical_url,
    date: post.post_date,
    description: post.body_html || post.subtitle || "",
    organisation,
  }));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function plainText(text, maxLength = 300) {
  if (!text) return "";

  let cleaned = text;

  // 1. Strip images
  cleaned = cleaned.replace(/<img[^>]*>/g, "");

  // 2. Strip shortcodes
  cleaned = stripShortcodes(cleaned);

  // 3. Strip all other HTML
  cleaned = cleaned.replace(/<[^>]*>/g, "");

  // 4. Replace any sequence of whitespace with a single space
  cleaned = cleaned.replace(/[\r\n]+/g, " "); // replace line breaks with a space
  cleaned = cleaned.replace(/\s+/g, " ").trim(); // collapse remaining whitespace

  // 5. Truncate
  if (cleaned.length > maxLength) {
    cleaned = cleaned.slice(0, maxLength) + "…";
  }

  return cleaned;
}

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

function stripShortcodes(text) {
  if (!text) return "";
  // Remove [shortcode ...] or [shortcode]…[/shortcode]
  return text.replace(/\[\/?[\w-]+(?:[^\]]*)\]/g, "");
}

// ----------------------------
// RUN
// ----------------------------

generateFeed().catch((err) => {
  console.error("Feed generation failed");
  console.error(err);
  process.exit(1);
});
