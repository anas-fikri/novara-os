# Guide: Creating Google OAuth Client ID

This document explains the steps to create and configure your own **Client ID** and **Client Secret** on the Google Cloud Console for use with the `novara login` feature.

---

## Step 1: Create a Project in Google Cloud Console
1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Log in using your Google account.
3. In the top-left corner (next to the Google Cloud logo), click the project drop-down menu, then click **New Project**.
4. Enter a project name (e.g., `Novara OS`), then click **Create**.

---

## Step 2: Configure the OAuth Consent Screen
Before creating your client credentials, you must configure the OAuth consent screen:
1. Search for **"OAuth consent screen"** in the top search bar and click on the matching menu option.
2. Select User Type: **External**, then click **Create**.
3. Fill in the required application details:
   - **App name**: `Novara OS`
   - **User support email**: Choose your email address.
   - **Developer contact information**: Enter your email address.
4. Click **Save and Continue**.
5. On the **Scopes** tab, click *Save and Continue* (no special configuration is required).
6. On the **Test Users** tab, add your own Google email address as a test user. This allows you to authenticate while the app is still in testing mode. Click *Save and Continue*.

---

## Step 3: Create the OAuth Client ID
1. Click the **Credentials** menu on the left sidebar.
2. At the top, click **+ Create Credentials** and select **OAuth client ID**.
3. Select **Application type**: `Web application`.
4. Enter a name (e.g., `Novara OS CLI`).
5. Under **Authorized redirect URIs**, click **+ Add URI** and enter the following local callback address:
   ```
   http://localhost:8085/callback
   ```
   > [!IMPORTANT]
   > The redirect URI must match the address above exactly so that the local callback listener in the terminal can retrieve the authentication token.
6. Click **Create**.

---

## Step 4: Save Credentials to Novara OS
Once successfully created, Google will show a pop-up containing **Your Client ID** and **Your Client Secret**.

Use the Novara OS CLI commands to save these credentials securely inside your active workspace:

```bash
# Save Google Client ID
novara set-key google_client_id "YOUR_CLIENT_ID"

# Save Google Client Secret
novara set-key google_client_secret "YOUR_CLIENT_SECRET"
```

Once saved, you can run the login command globally:
```bash
novara login
```
This will automatically open your default browser to complete the Google authentication flow.
