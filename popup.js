document.addEventListener("DOMContentLoaded", function () {
  chrome.storage.sync.get("user", function (data) {
    if (data.user) {
      showDashboard(data.user);
    }
  });

  document.getElementById("loginButton").addEventListener("click", async () => {
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;

    try {
      const response = await fetch(
        "https://extension-backend-waj7.onrender.com/users/login",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email, password }),
        }
      );

      const data = await response.json();
      if (response.ok) {
        document.getElementById("status").textContent = "Login successful";
        // Send a message to the background script with the user data
        chrome.runtime.sendMessage(
          { type: "login", user: data },
          function (response) {
            if (response.success) {
              console.log("User data saved");
              showDashboard(data);
            }
          }
        );
      } else {
        document.getElementById("status").textContent = data.error;
      }
    } catch (error) {
      document.getElementById("status").textContent = "An error occurred";
      console.error("Error:", error);
    }
  });

  function showDashboard(user) {
    document.getElementById("loginSection").style.display = "none";
    document.getElementById("dashboard").style.display = "block";
    document.getElementById("userName").textContent = user.name;
    document.getElementById("userEmail").textContent = user.email;
  }
});
