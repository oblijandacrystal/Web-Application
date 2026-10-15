"use strict";

const API = "https://openlibrary.org";
const COVERS = "https://covers.openlibrary.org/b/id";
const STORAGE = {list: "br_reading_list", recent: "br_recent", style: "br_style"};
const MAX_RECENT = 6;

const select = (sel) => document.querySelector(sel);

const searchForm = select("#search-form");
const searchType = select("#search-type");
const searchInput = select("#search-input");
const searchResults = select("#search-results");

searchInput.addEventListener("input", () => {
    if (searchInput.value.trim() === "") {
        searchResults.innerHTML = `
            <h2>Search Results</h2>
            <p>Search for a book to see the results here.</p>
        `;
    }
});

const bookDetails = select("#book-details");
const recentList = select("#recent-list");
const recentControls = select("#recent-controls");
const selectAllRecent = select("#select-all-recent");
const readingListEl = select("#reading-list");
const citationList = select("#citation-list");
const citationStyle = select("#citation-style");
const seeMoreButton = select("#see-more");
const RECENT_LIMIT = 4;
let showAllRecent = false;

const bookCache = new Map();

let readingList = loadStorage(STORAGE.list, []);
let recent = loadStorage(STORAGE.recent, []);
[...readingList, ...recent].forEach((b) => bookCache.set(b.id, b));

function loadStorage(key, fallback)  {
    try{
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch {
        return fallback;
    }
}

function saveStorage(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {

    }
}

function esc(text) {
    return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

async function fetchJson(url) {
    const response = await fetch(url);
    if(!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
    }
    return response.json();   
}

function coverUrl(coverId, size = "M") {
    return coverId 
    ? `${COVERS}/${coverId}-${size}.jpg` 
    : "";
}

function authorsText(book) {
    return book.authors && book.authors.length ? book.authors.join(", ") : "Unknown author";
}

function isSaved(id) {
    return readingList.some((b) => b.id === id);
}

function pickYear(text) {
    const m = String(text ?? "").match(/\d{4}/);
    return m ? m[0] : "";
}

async function searchBooks(query, type) {
    const parameter = type === "title" ? "title" : type === "author" ? "author" : "q";
    const fields = "key,title,author_name,first_publish_year,cover_i,publisher";
    const url = `${API}/search.json?${parameter}=${encodeURIComponent(query)}&limit=12&fields=${fields}`;
    
    const data = await fetchJson(url);

    return data.docs.map((doc) => ( {
        id: doc.key.split("/").pop(),
        title: doc.title,
        authors: doc.author_name || [],
        year: doc.first_publish_year ? String(doc.first_publish_year) : "",
        coverId: doc.cover_i || null,
        publisher: doc.publisher ? doc.publisher[0] : "",
    }));
}

//para API

async function fetchBook(id) {
    const cached = bookCache.get(id) || {};
    
    const [work, editions] = await Promise.all ([
        fetchJson(`${API}/works/${id}.json`),
        fetchJson(`${API}/works/${id}/editions.json?limit=1`)
        .catch(() => null)
    ]);

    const authorKeys = (work.authors || [])
        .map((a) => a.author && a.author.key)
        .filter(Boolean)
        .slice(0, 3);

    const names = (
        await Promise.all (
            authorKeys.map((k) =>
            fetchJson(`${API}${k}.json`).then((a) => a.name).catch(() => null)
        )
    )
).filter(Boolean);

const edition = editions && editions.entries ? editions.entries[0] : null;

let description = "";
    if(typeof work.description === "string") {
        description = work.description;    
    } else if(work.description && work.description.value) {
        description = work.description.value;
    }
    description = description.split("----------")[0].trim();

const coverId = (work.covers || []).find((c) => c > 0) || cached.coverId || null;

const book = {
    id,
    title: work.title || cached.title || "Untitled",
    authors: names.length ? names : cached.authors || [],
    year:
        cached.year ||
        pickYear(work.first_publish_date) ||
        pickYear(edition && edition.publish_date),
    coverId,
        publisher: (edition && edition.publishers && edition.publishers[0]) || cached.publisher || "",
        pages: edition && edition.number_of_pages ? edition.number_of_pages : "",
    description,
        subjects: (work.subjects || []).slice(0, 8),
};

    bookCache.set(id, book);
    return book;
}

//hash based SPA

function router() {
    const hash = location.hash.slice(1) || "search";
    const [route, parameter] = hash.split("/");

    const target = document.getElementById(route) && document.getElementById(route).classList.contains("view") ? route : "search";

    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === target));

    const navTarget = target === "book" ? "search" : target;
    document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + navTarget));

    if(target === "book" && parameter) loadBook(parameter);
    if(target === "recently-viewed") renderRecent();
    if(target === "readinglist") renderReadingList();
    if(target === "citations") renderCitations();

    window.scrollTo(0, 0);
}

window.addEventListener("hashchange", router);

//rendiring  ngani

function bookRow(b) {
    const label = isSaved(b.id) ? "Remove" : "Save";
        return `
            <article class="saved-book">
                <img src="${coverUrl(b.coverId)}" alt="Cover of ${esc(b.title)}" loading="lazy">

                <div class="book-info">
                    <h3>${esc(b.title)}</h3>
                    <p>${esc(authorsText(b))}</p>
                    <p>${esc(b.year || "n.d.")}</p>
                </div>

                <div class="book-actions">
                    <a class="button" href="#book/${esc(b.id)}">View Details
                    </a>

                    <button type="button" data-action="toggle" data-id="${esc(b.id)}">${label}
                    </button>
                </div>
        </article>`;
}

function renderResults(books) {
    if(books.length === 0) {
        searchResults.innerHTML = "<h2>Search Results</h2> <p>No books found. Try different words.</p>";
        return;
    }
    books.forEach((b) => bookCache.set(b.id, { ...bookCache.get(b.id), ...b}));
    searchResults.innerHTML = "<h2>Search Results</h2>" + books.map(bookRow).join("");     
    }

    async function loadBook(id) {
        bookDetails.innerHTML = "<p>Loading...</p>";

        try {
            const book = await fetchBook(id);

            if(location.hash !== `#book/${id}`) return;

            addRecent(book);

            bookDetails.innerHTML = `
                ${book.coverId ? `<img src="${coverUrl(book.coverId, "L")}" alt="Cover of ${esc(book.title)}">` : ""}

                <div class="details-text">
                    <h2>${esc(book.title)}</h2>
                    <p><strong>Author:</strong> ${esc(authorsText(book))}</p>
                    <p>
                        <strong>First published:</strong>
                        ${esc(book.year || "n.d.")}
                        ${book.publisher 
                        ? ` &middot; <strong>Publisher:</strong> ${esc(book.publisher)}` 
                        : ""}
                        ${book.pages 
                        ? ` &middot; <strong>Pages:</strong> ${esc(book.pages)}` 
                        : ""}
                    </p>

                    <p>
                        ${esc(book.description || "No description available.")
                        .replace(/\n/g, "<br>")}
                    </p>

                    <p>
                        <strong>Subjects:</strong> 
                        ${esc(book.subjects.join(", ") || "None listed")}
                    </p>

                <div class="details-actions">
                    <button type="button" 
                            class="button" 
                            data-action="toggle" 
                            data-id="${esc(book.id)}">
                        ${isSaved(book.id) 
                            ? "Remove from Reading List" 
                            : "Add to Reading List"}
                    </button>

                <a class="button" 
                    href="https://openlibrary.org/works/${esc(book.id)}" 
                    target="_blank" 
                    rel="noopener">
                        Open Library page
                    </a>
            </div>
      </div>`; 

    } catch (err) {
        console.error(err);
        bookDetails.innerHTML = "<p>Couldn't load this book. Check your connection and try again</p>";
    }
}

function renderRecent() {
    if(recent.length === 0) {
        recentList.innerHTML = "<p>You haven't opened any books yet.</p>";

        recentControls.hidden = true;
        seeMoreButton.hidden = true;
        selectAllRecent.checked = false;

        return;
    }

    const displayedBooks = showAllRecent
        ? recent
        : recent.slice(0, RECENT_LIMIT);
    
    recentList.innerHTML = displayedBooks.map((b) => `
        <article class="book-card">
            <label class="recent-select">
                <input
                    type="checkbox"
                    class="recent-checkbox"
                    value="${esc(b.id)}"
                    aria-label="Select ${esc(b.title)}"
                >
            </label>

            <a href="#book/${esc(b.id)}">
                <img src="${coverUrl(b.coverId)}" 
                    alt="Cover of ${esc(b.title)}" 
                    loading="lazy">
                <h3>${esc(b.title)}</h3>
            </a>
      </article>
      `).join("");

    recentControls.hidden = false;
    selectAllRecent.checked = false;

    seeMoreButton.hidden = recent.length <= RECENT_LIMIT;
    seeMoreButton.textContent = showAllRecent ? "Show Less" : "See More...";
}

seeMoreButton.addEventListener("click", () => {
    showAllRecent = !showAllRecent;
    renderRecent();
});

selectAllRecent.addEventListener("change", () => {
    recentList.querySelectorAll(".recent-checkbox").forEach((checkbox) => {
        checkbox.checked = selectAllRecent.checked;
    });
});

function renderReadingList() {
    if(readingList.length === 0) {
        readingListEl.innerHTML = "<p>Your reading list is empty. Save a book from the search results</p>";
        return;
    }
    readingListEl.innerHTML = readingList.map(bookRow).join("");
}

function renderCitations() {
    if(readingList.length === 0) {
        citationList.innerHTML = 
            "<p>Save books to your reading list to generate citations.</p>";
        return;
    }

    const style = citationStyle.value;

    citationList.innerHTML = readingList.map((b) => `
                <article class="citation-item">
                    <div class="citation-book">
                        <img
                            src="${coverUrl(b.coverId)}"
                            alt="Cover of ${esc(b.title)}"
                            loading="lazy"
                        >

                        <h3>${esc(b.title)}</h3>
                    </div>

                    <div class="citation-details">
                        <p class="citation-text">
                            ${formatCitation(b, style)}
                        </p>
                    
                        <button 
                            type="button"
                            class="link-button"
                            data-action="copy"
                        >Copy Citation</button>
                    </div>
                </article>
            `).join("");
        }

function toggleSaved(id) {
    const book = bookCache.get(id);
    if (!book) return;

    if(isSaved(id)) {
        readingList = readingList.filter((b) => b.id !== id);
    } else {
        readingList.unshift(slim(book));
    }
    saveStorage(STORAGE.list, readingList);

    refreshAfterListChange();
}

function slim(b) {
    return {
        id: b.id,
        title: b.title,
        authors: b.authors || [],
        year: b.year || "",
        coverId: b.coverId || null,
        publisher: b.publisher || "",
    };
}

function addRecent(book) {
    recent = [slim(book), ...recent.filter((b) => b.id !== book.id)].slice(0, MAX_RECENT);
    saveStorage(STORAGE.recent, recent);
}

function refreshAfterListChange() {
    document.querySelectorAll('[data-action="toggle"]').forEach((btn) => {
        const saved = isSaved(btn.dataset.id);
        const inDetails = bookDetails.contains(btn);
        btn.textContent = inDetails ? saved ? "Remove from Reading List" : "Add to Reading List" : saved ? "Remove" : "Save";
    });

    if(select("#readinglist").classList.contains("active")) renderReadingList();
    if(select("#citations").classList.contains("active")) renderCitations();
}

// Citatios (APA / MLA / Chicago)

function splitName(full) {
    const parts = full.trim().split(/\s+/);
    const last = parts.pop();
    return { first: parts.join(" "), last};
}

function initials(first) {
    return first
        .split(/\s+/)
        .filter(Boolean)
        .map((p) => p[0].toUpperCase() + ".")
        .join(" ");
}

function authorsApa(list) {
    const names = list.map((n) => {
        const { first, last } = splitName(n);
        return first ? `${last}, ${initials(first)}` : last;
    });

    if(names.length === 1) return names[0];

    if(names.length === 2) {
        return `${names[0]}, & ${names[1]}`;
    }

    return `${names.slice(0, -1).join(", ")}, & ${names[names.length - 1]}`;
}

function authorsMLA(list) {
    const inverted = (n) => {
        const { first, last } = splitName(n);
        return first ? `${last}, ${first}` : last;
    };
    if(list.length === 1) return inverted(list[0]);
    if(list.length === 2) return `${inverted(list[0])}, and ${list[1]}`;
    return `${inverted(list[0])}, et al`;
}

function formatCitation(b, style) {
    const title = `<i>${esc(b.title)}</i>`;
    const year = esc(b.year || "n.d.");
    const pub = b.publisher ? esc(b.publisher) : "";
    const hasAuthors = b.authors && b.authors.length > 0;

    if(style === "apa") {
        const who = hasAuthors ? esc(authorsApa(b.authors)) : title;
        return hasAuthors 
            ? `${who} (${year}). ${title}.${pub ? ` ${pub}.` : ""}`
            : `${title}. (${year}).${pub ? `${pub}. ` : ""}`;
    }

        const who = hasAuthors ? esc(authorsMLA(b.authors)) + ". " : "";
        return `${who}${title}. ${pub ? pub + ", " : ""}${year}.`;
}

function copyText(text) {
    if(navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(text);
    }

    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.opacity = "0";
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand("copy");
    textArea.remove();
    return Promise.resolve();
}

//functionality of the Book Reasearcher

let searchRequestedId = 0;

searchForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const query = searchInput.value.trim();
    if(!query) return;

    searchResults.innerHTML = "<h2>Search Results</h2> <p>Searching...</p>";

    try {
        renderResults(await searchBooks(query, searchType.value));
    } catch (err) {
        console.error(err);
        searchResults.innerHTML = "<h2>Search Results</h2> <p>Something went wrong. Please try again.</p>";
    }
});

document.addEventListener("click", (e) => {
    const button = e.target.closest("[data-action]");
    if(!button) return;

    const action = button.dataset.action;

    if(action === "toggle") {
        toggleSaved(button.dataset.id);
    }

    if(action === "clear-recent") {
        recent = [];
        showAllRecent = false;
        saveStorage(STORAGE.recent, recent);
        renderRecent();
    }


    if(action === "remove-selected") {
        const selectedIds = [
            ...recentList.querySelectorAll(".recent-checkbox:checked")
            ].map((checkbox) => checkbox.value);

            if(selectedIds.length === 0) {
                alert("Please select at least one book to remove");
                return;
            }

            recent = recent.filter((book) => !selectedIds.includes(book.id));

            saveStorage(STORAGE.recent, recent);
            renderRecent();         
    }

    if(action === "copy") {
        const text = button.parentElement.querySelector(".citation-text").textContent;

        copyText(text)
            .then(() => {
                button.textContent = "Copied!";
                setTimeout(() => {
                    button.textContent = "Copy";
                }, 1500);
        })
        .catch((err) => {
            console.error("Failed to copy citation:", err);
            alert("Unable to copy the citation. Please try again.");
        });
    }
});

citationStyle.value = loadStorage(STORAGE.style, "apa");
citationStyle.addEventListener("change", () => {
    saveStorage(STORAGE.style, citationStyle.value);
    renderCitations();
});


router();