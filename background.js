console.log("background.js loaded");

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  console.log("Message received from content script:", request);
  if (request.type === "login") {
    // Save authenticated user data to Chrome storage
    chrome.storage.sync.set({ user: request.user }, function () {
      console.log("User data saved");
      sendResponse({ success: true });
    });
    return true; // Indicates that the response will be sent asynchronously
  }
});


//hash set for domains
const Domains = new Set();
const restrictedDomains = [];
const domainTimeLimits = {};
const domainStats = {}; // To track usage time for each domain
const pageStats = {}; // To track usage time for specific pages within each domain
let currentDomain = null;
let currentPage = null;
let currentStartTime = null;
let previousTabId = null;












// Function to fetch restricted domains for the current user from the backend
function fetchRestrictedDomains() {
  // Retrieve the user information from Chrome storage
  chrome.storage.sync.get("user", (result) => {
    console.log("User data retrieved:", result.user);
    if (result.user) {
      // Fetch restricted domains for the current user
      fetch(`http://localhost:3000/domains?email=${result.user.email}`)
        .then((response) => response.json())
        .then((data) => {
          console.log(
            "Restricted domains data received:",
            JSON.stringify(data)
          );
          restrictedDomains.length = 0; // Clear the existing array
          data.restricted_domains.forEach((domain) => {
            restrictedDomains.push(domain.domain_name);
          });
        })
        .catch((error) =>
          console.error("Error fetching restricted domains:", error)
        );

      // Fetch time limits for the current user
      fetch(`http://localhost:3000/domains/time_limits?email=${result.user.email}`)
        .then((response) => response.json())
        .then((data) => {
          console.log("Time limits data received:", data);
          if (Array.isArray(data)) {
            // Update the domainTimeLimits object with the fetched data
            data.forEach((domain) => {
              domainTimeLimits[domain.domain_name] = {
                timeLimit: domain.time_limit,
                startTime: null,
              };
            });
            console.log("Domain time limits:", domainTimeLimits);
          } else {
            console.error("Unexpected data format for time limits:", data);
          }
        })
        .catch((error) =>
          console.error("Error fetching time limits:", error)
        );
    }
  });
}

// Helper function to extract domain from a URL
function extractDomain(url) {
  const urlObj = new URL(url);
  return urlObj.hostname;
}

// Helper function to extract page path from a URL
function extractPagePath(url) {
  const urlObj = new URL(url);
  return `${urlObj.hostname}${urlObj.pathname}`;
}
// Function to close a tab with an alert
function closeTab(tabId, message) {
  chrome.scripting.executeScript(
    {
      target: { tabId: tabId },
      func: (msg) => alert(msg),
      args: [message],
    },
    () => {
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError.message);
      } else {
        // Check if the tab still exists before attempting to remove it
        chrome.tabs.get(tabId, (existingTab) => {
          if (existingTab) {
            chrome.tabs.remove(tabId, () => {
              if (chrome.runtime.lastError) {
                console.error(chrome.runtime.lastError.message);
              } else {
                console.log(`Tab closed: ${existingTab.url}`);
              }
            });
          } else {
            console.log(`Tab with ID ${tabId} no longer exists.`);
          }
        });
      }
    }
  );
}

// Function to log domain stats
function logDomainStats(domain) {
  if (domainStats[domain]) {
    console.log(`Domain: ${domain}`);
    console.log(`Visit Count: ${domainStats[domain].visitCount}`);
    console.log(`Total Time Spent: ${domainStats[domain].totalTimeSpent} seconds`);
  }
}

// Function to log page stats
function logPageStats(page) {
  if (pageStats[page]) {
    console.log(`Page: ${page}`);
    console.log(`Total Time Spent: ${pageStats[page].totalTimeSpent} seconds`);
  }
}

// Function to handle tab activation
function handleTabActivated(tabId) {
  chrome.tabs.get(tabId, (tab) => {
    if (tab && tab.url && !tab.url.startsWith("chrome://")) {
      const newDomain = extractDomain(tab.url);
      Domains.add(newDomain);
      console.log(Domains.size);
      const newPage = extractPagePath(tab.url);
      console.log(`Activated tab URL: ${tab.url}, Domain: ${newDomain}, Page: ${newPage}`);

      // Check if the domain is restricted
      if (restrictedDomains.includes(newDomain)) {
        closeTab(tab.id, "This tab is restricted. The tab will be closed.");
        return; // Exit early to prevent further processing
      }

      // If there was a previously active domain and page, calculate the time spent on it
      if (currentDomain && currentPage && currentStartTime) {
        const timeSpent = (Date.now() - currentStartTime) / 1000; // Convert milliseconds to seconds
        if (!domainStats[currentDomain]) {
          domainStats[currentDomain] = { visitCount: 0, totalTimeSpent: 0 };
        }
        if (!pageStats[currentPage]) {
          pageStats[currentPage] = { totalTimeSpent: 0 };
        }
        domainStats[currentDomain].totalTimeSpent += timeSpent;
        pageStats[currentPage].totalTimeSpent += timeSpent;

        // If time exceeds the limit, show alert and close the tab
        if (domainTimeLimits[currentDomain] && domainStats[currentDomain].totalTimeSpent > domainTimeLimits[currentDomain].timeLimit * 60) {
          closeTab(tab.id, "Time limit for this domain has been exceeded. The tab will be closed.");
          return; // Exit early to prevent further processing
        }
      }

      // Update current domain, page, and start time
      currentDomain = newDomain;
      currentPage = newPage;
      currentStartTime = Date.now();

      // Update visit count for the new domain
      if (!domainStats[newDomain]) {
        domainStats[newDomain] = { visitCount: 0, totalTimeSpent: 0 };
      }
      if (previousTabId !== tabId) {
        domainStats[newDomain].visitCount += 1;
      }
      previousTabId = tabId;

      // Log the domain and page stats
      logDomainStats(newDomain);
      logPageStats(newPage);
    }
  });
}

async function updateDomain() {
  console.log("Updating domain data");

  chrome.storage.sync.get("user", async (result) => {
    if (result.user) {
      try {
        for (const domain of Domains) { // Directly iterate over the Set
          console.log("Updating domain:", domain);
          const response = await fetch('http://localhost:3000/domains/update_domain', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              email: result.user.email,
              domain_name: domain
            }),
          });

          if (!response.ok) {
            throw new Error('Failed to update domain data');
          }

          const data = await response.json();
          console.log(`Domain data updated for ${domain}:`, data);
        }
      } catch (error) {
        console.error("Error updating domain data:", error);
      }
    }
  });
}

// Periodically check the active tab



async function updateDomainUsage() {
  console.log("Updating domain data");
  chrome.storage.sync.get("user", async (result) => {
    if (result.user) {
      try {
        for (const domain of Domains) {
          console.log("Set", domain);
          const response = await fetch('http://localhost:3000/domain_usages/', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              email: result.user.email,
              domain_name: domain,
               //rounding off to 2 decimal places 
              usage: Math.round(domainStats[domain].totalTimeSpent * 100) / 100,
              visitCount: domainStats[domain].visitCount
            }),
          });
          if (!response.ok) {
            throw new Error('Failed to update domain data');
          }
          const data = await response.json();
          console.log(`Domain data updated for ${domain}:`, data);
        }
      } catch (error) {
        console.error("Error updating domain data:", error);
      }
    }
  });
}


function updatesubDomainsUsage() {
  
}
setInterval(() => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length > 0) {
      handleTabActivated(tabs[0].id);
    }
  });
}, 1000);

// Periodically update the domain data
// setInterval(() => {
//   console.log("Updating domain data");
//   updateDomain();
// }, 10000); // Adjust the interval as needed (e.g., every 10 seconds)

setInterval(() => {
  console.log("Updating domain_uage data");
  updateDomainUsage();
}, 20000); // Adjust the interval as needed (e.g., every 10 seconds)

// Initial fetch of restricted domains and time limits when the extension is loaded
fetchRestrictedDomains();