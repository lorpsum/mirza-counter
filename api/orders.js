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

    /*
     * =====================================================
     * 1. REFRESH ACCESS TOKEN
     * =====================================================
     */

    const tokenResponse = await fetch(
      `https://${shop}.myshopify.com/admin/oauth/access_token`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded"
        },

        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken
        })
      }
    );

    const tokenData =
      await tokenResponse.json();


    if (
      !tokenResponse.ok ||
      !tokenData.access_token
    ) {
      console.error(
        "SHOPIFY TOKEN ERROR:",
        tokenData
      );

      return res.status(500).json({
        error: "Shopify authentication failed",
        details:
          tokenData.error_description ||
          tokenData.error ||
          tokenData
      });
    }


    const accessToken =
      tokenData.access_token;


    /*
     * =====================================================
     * 2. GET ORDER COUNT
     * =====================================================
     */

    const shopifyResponse = await fetch(
      `https://${shop}.myshopify.com/admin/api/2026-07/graphql.json`,
      {
        method: "POST",

        headers: {
          "Content-Type":
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
      }
    );


    const shopifyData =
      await shopifyResponse.json();


    if (
      !shopifyResponse.ok ||
      shopifyData.errors
    ) {

      console.error(
        "SHOPIFY API ERROR:",
        shopifyData
      );

      return res.status(500).json({
        error: "Shopify API error",
        details:
          shopifyData.errors ||
          shopifyData
      });

    }


    const count =
      shopifyData?.data?.ordersCount?.count;


    if (
      count === undefined ||
      count === null
    ) {

      return res.status(500).json({
        error: "Order count not found",
        details: shopifyData
      });

    }


    /*
     * =====================================================
     * 3. RETURN COUNT
     * =====================================================
     */

    return res.status(200).json({
      count: Number(count)
    });


  } catch (error) {

    console.error(
      "SERVER ERROR:",
      error
    );


    return res.status(500).json({
      error: "Server error",
      details: error.message
    });

  }
}
