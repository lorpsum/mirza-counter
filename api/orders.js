export default async function handler(req, res) {
  try {
    const shop = process.env.SHOPIFY_SHOP;
    const clientId = process.env.SHOPIFY_CLIENT_ID;
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
    const refreshToken = process.env.SHOPIFY_REFRESH_TOKEN;

    if (!shop || !clientId || !clientSecret || !refreshToken) {
      return res.status(500).json({
        error: "Shopify credentials are missing"
      });
    }

    // ==========================================
    // 1. REFRESH TOKEN
    // ==========================================

    const tokenUrl =
      `https://${shop}.myshopify.com/admin/oauth/access_token`;

    const tokenResponse = await fetch(tokenUrl, {
      method: "POST",

      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded",
        "Accept":
          "application/json"
      },

      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken
      })
    });

    const tokenText =
      await tokenResponse.text();

    let tokenData;

    try {
      tokenData =
        JSON.parse(tokenText);
    } catch (error) {

      console.error(
        "SHOPIFY TOKEN RAW RESPONSE:",
        tokenText
      );

      return res.status(500).json({
        error:
          "Shopify token endpoint returned non-JSON",
        status:
          tokenResponse.status,
        response:
          tokenText.substring(0, 500)
      });
    }

    if (
      !tokenResponse.ok ||
      !tokenData.access_token
    ) {

      console.error(
        "SHOPIFY TOKEN ERROR:",
        tokenData
      );

      return res.status(500).json({
        error:
          "Shopify authentication failed",
        status:
          tokenResponse.status,
        details:
          tokenData
      });
    }

    const accessToken =
      tokenData.access_token;


    // ==========================================
    // 2. SHOPIFY GRAPHQL
    // ==========================================

    const graphqlUrl =
      `https://${shop}.myshopify.com/admin/api/2026-07/graphql.json`;

    const shopifyResponse =
      await fetch(graphqlUrl, {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          "Accept":
            "application/json",

          "X-Shopify-Access-Token":
            accessToken
        },

        body: JSON.stringify({
          query: `
            query {
              ordersCount {
                count
                precision
              }
            }
          `
        })
      });


    const shopifyText =
      await shopifyResponse.text();

    let shopifyData;

    try {

      shopifyData =
        JSON.parse(shopifyText);

    } catch (error) {

      console.error(
        "SHOPIFY GRAPHQL RAW RESPONSE:",
        shopifyText
      );

      return res.status(500).json({
        error:
          "Shopify GraphQL returned non-JSON",
        status:
          shopifyResponse.status,
        response:
          shopifyText.substring(0, 500)
      });

    }


    if (
      !shopifyResponse.ok ||
      shopifyData.errors
    ) {

      console.error(
        "SHOPIFY API ERROR:",
        shopifyData
      );

      return res.status(500).json({
        error:
          "Shopify API error",
        status:
          shopifyResponse.status,
        details:
          shopifyData.errors ||
          shopifyData
      });

    }


    // ==========================================
    // 3. ORDER COUNT
    // ==========================================

    const count =
      shopifyData?.data?.ordersCount?.count;


    if (
      count === undefined ||
      count === null
    ) {

      return res.status(500).json({
        error:
          "Order count not found",
        details:
          shopifyData
      });

    }


    // ==========================================
    // 4. SUCCESS
    // ==========================================

    return res.status(200).json({
      count:
        Number(count)
    });


  } catch (error) {

    console.error(
      "SERVER ERROR:",
      error
    );

    return res.status(500).json({
      error:
        "Server error",
      details:
        error.message
    });

  }
}
