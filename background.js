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
const domain_usage_id = [];
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
      fetch(
        `https://extension-backend-waj7.onrender.com/domains?email=${result.user.email}`
      )
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
      fetch(
        `https://extension-backend-waj7.onrender.com/domains/time_limits?email=${result.user.email}`
      )
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
        .catch((error) => console.error("Error fetching time limits:", error));
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
    console.log(
      `Total Time Spent: ${domainStats[domain].totalTimeSpent} seconds`
    );
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

      console.log(Domains.size);
      const newPage = extractPagePath(tab.url);
      console.log(
        `Activated tab URL: ${tab.url}, Domain: ${newDomain}, Page: ${newPage}`
      );

      // Check if the domain is restricted
      if (restrictedDomains.includes(newDomain)) {
        closeTab(tab.id, "This tab is restricted. The tab will be closed.");
        return; // Exit early to prevent further processing
      }
      Domains.add(newDomain);
      if (!pageStats[newDomain]) {
        pageStats[newDomain] = {};
      }
      // If there was a previously active domain and page, calculate the time spent on it
      if (currentDomain && currentPage && currentStartTime) {
        const timeSpent = (Date.now() - currentStartTime) / 1000; // Convert milliseconds to seconds
        if (!domainStats[currentDomain]) {
          domainStats[currentDomain] = { visitCount: 0, totalTimeSpent: 0 };
        }
        if (!pageStats[currentDomain][currentPage]) {
          pageStats[currentDomain][currentPage] = { totalTimeSpent: 0 };
        }
        pageStats[currentDomain][currentPage].totalTimeSpent += timeSpent;
        domainStats[currentDomain].totalTimeSpent += timeSpent;

        // If time exceeds the limit, show alert and close the tab
        // if (domainTimeLimits[currentDomain] && domainStats[currentDomain].totalTimeSpent > domainTimeLimits[currentDomain].timeLimit * 60) {
        //   closeTab(tab.id, "Time limit for this domain has been exceeded. The tab will be closed.");
        //   return; // Exit early to prevent further processing
        // }
      }

      // Update current domain, page, and start time
      currentDomain = newDomain;
      currentPage = newPage;
      currentStartTime = Date.now();
      if (
        domainTimeLimits[currentDomain] &&
        domainStats[currentDomain] &&
        domainStats[currentDomain].totalTimeSpent >
          domainTimeLimits[currentDomain].timeLimit * 60
      ) {
        closeTab(
          tab.id,
          "Time limit for this domain has been exceeded. The tab will be closed."
        );
        return; // Exit early to prevent further processing
      }

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
//
async function fetchDomainUsage() {
  console.log("Fetching domain usage data");

  chrome.storage.sync.get("user", async (result) => {
    if (result.user) {
      try {
        const response = await fetch(
          `https://extension-backend-waj7.onrender.com/domain_usages?id=${result.user.id}`
        );
        if (!response.ok) {
          throw new Error("Failed to fetch domain usage data");
        }

        const data = await response.json();
        console.log("Domain usage data:", data);
        for (const domainName in data) {
          if (data.hasOwnProperty(domainName)) {
            domainStats[domainName] = {
              visitCount: data[domainName].visitCount,
              totalTimeSpent: data[domainName].totalTimeSpent * 60,
            };
          }
        }
        console.log("Domain stats after fetch:", domainStats);
      } catch (error) {
        console.error("Error fetching domain usage data:", error);
      }
    }
  });
}

async function fetchDomainsUsageId() {
  console.log("Fetching sub domain usage data");

  chrome.storage.sync.get("user", async (result) => {
    if (result.user) {
      try {
        const response = await fetch(
          `https://localhost:3000/domain_usages/user_id/${result.user.id}`
        );
        if (!response.ok) {
          throw new Error("Failed to fetch sub domain usage data");
        }
        const data = await response.json();

        //using this data fetch the sub domain usage data
        console.log("Sub domain usage data:", data);
        // SEND ANOTHER FETCH REQUEST TO THE BACKEND TO FETCH THE SUB DOMAIN USAGE DATA
        for (const domain in data) {
          domain_usage_id.push(data[domain].id);
        }
      } catch (error) {
        console.error("Error fetching sub domain usage data:", error);
      }
    }
  });
}

async function fetchsubDomainsUsage() {
  console.log("Fetching domain usage data");

  chrome.storage.sync.get("user", async (result) => {
    if (result.user) {
      try {
        // Fetch domain usage IDs
        const domainUsageResponse = await fetch(
          `https://extension-backend-waj7.onrender.com/domain_usages/user_id/${result.user.id}`
        );

        if (!domainUsageResponse.ok) {
          throw new Error("Failed to fetch domain usage IDs");
        }

        const domainUsageIds = await domainUsageResponse.json();

        // Iterate through each domain usage ID to fetch subdomain usage data
        for (const usage of domainUsageIds) {
          const subdomainUsageResponse = await fetch(
            `https://extension-backend-waj7.onrender.com/subdomains?domain_usage_id=${usage.id}`
          );

          if (!subdomainUsageResponse.ok) {
            throw new Error("Failed to fetch subdomain usage data");
          }

          const subdomainData = await subdomainUsageResponse.json();

          // Update pageStats with subdomain data
          for (const subdomain of subdomainData) {
            const { domain_name, subdomain_name, time_spent } = subdomain;

            if (!pageStats[domain_name]) {
              pageStats[domain_name] = {};
            }

            if (!pageStats[domain_name][subdomain_name]) {
              pageStats[domain_name][subdomain_name] = { totalTimeSpent: 0 };
            }

            // Assuming domain_name is unique, and domain_name and subdomain_name together uniquely identify a subdomain
            pageStats[domain_name][subdomain_name].totalTimeSpent =
              time_spent * 60;
          }
        }

        console.log("Sub domain stats after fetch:", pageStats);
      } catch (error) {
        console.error("Error fetching sub domain usage data:", error);
      }
    }
  });
}

async function updateDomain() {
  console.log("Updating domain data");

  chrome.storage.sync.get("user", async (result) => {
    if (result.user) {
      try {
        for (const domain of Domains) {
          // Directly iterate over the Set
          console.log("Updating domain:", domain);
          const response = await fetch(
            "https://extension-backend-waj7.onrender.com/domains/update_domain",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                email: result.user.email,
                domain_name: domain,
              }),
            }
          );

          if (!response.ok) {
            throw new Error("Failed to update domain data");
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
          console.log(
            "Set",
            (domainStats[domain].totalTimeSpent / 60).toFixed(2)
          );
          const response = await fetch(
            "https://extension-backend-waj7.onrender.com/domain_usages/",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                email: result.user.email,
                domain_name: domain,
                total_time_spent: (
                  domainStats[domain].totalTimeSpent / 60
                ).toFixed(2),
                visitCount: domainStats[domain].visitCount,
              }),
            }
          );
          if (!response.ok) {
            throw new Error("Failed to update domain data");
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

async function updatesubDomainsUsage() {
  console.log("Updating domain data");
  console.log("PageStats", pageStats);
  chrome.storage.sync.get("user", async (result) => {
    if (result.user) {
      try {
        for (const domain in pageStats) {
          console.log("Updating domain:", domain);
          for (const page in pageStats[domain]) {
            console.log("Updating page:", page);
            console.log(
              "Time spent:",
              (pageStats[domain][page].totalTimeSpent / 60).toFixed(2),
              "domain_name:",
              domain,
              "subdomain_name:",
              page
            );
            const response = await fetch(
              "https://extension-backend-waj7.onrender.com/subdomains",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  user_id: result.user.id,
                  domain_name: domain,
                  subdomain_name: page,
                  time_spent: (
                    pageStats[domain][page].totalTimeSpent / 60
                  ).toFixed(2),
                }),
              }
            );
            if (!response.ok) {
              throw new Error("Failed to update page data");
            }
            const data = await response.json();
            console.log(`Page data updated for ${page} in ${domain}:`, data);
          }
        }
      } catch (error) {
        console.error("Error updating page data:", error);
      }
    }
  });
}

// fetchRestrictedDomains();
// fetchDomainUsage();

fetchRestrictedDomains();
fetchDomainUsage();
fetchsubDomainsUsage();

setInterval(() => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length > 0) {
      handleTabActivated(tabs[0].id);
    }
  });
}, 1000);

// Periodically update the domain data
setInterval(() => {
  console.log("Updating domain data");
  updateDomain();
}, 120000);

setInterval(() => {
  console.log("Updating domain_uage data");
  updateDomainUsage();
}, 180000);

setInterval(() => {
  console.log("Updating subdomain data");
  updatesubDomainsUsage();
}, 180000);

// Initial fetch of restricted domains and time limits when the extension is loaded
