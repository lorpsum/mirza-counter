
export default async function handler(req, res) {
  try {
    const shop = process.env.SHOPIFY_SHOP;
    const clientId = process.env.SHOPIFY_CLIENT_ID;
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

    if (!shop || !clientId || !clientSecret) {
      return res.status(500).json({
        error: "Shopify credentials are missing"
      });
    }

    // 1. AUTHENTIFICATION

    const tokenResponse = await fetch(
      `https://${shop}.myshopify.com/admin/oauth/access_token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json"
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: clientId,
          client_secret: clientSecret
        })
      }
    );

    const tokenText = await tokenResponse.text();
    let tokenData;

    try {
      tokenData = JSON.parse(tokenText);
    } catch {
      return res.status(500).json({
        error: "Invalid Shopify token response"
      });
    }

    if (!tokenResponse.ok || !tokenData.access_token) {
      return res.status(500).json({
        error: "Shopify authentication failed",
        status: tokenResponse.status,
        details: tokenData
      });
    }

    const accessToken = tokenData.access_token;

    // 2. VALIDATION DES DATES

    const { start, end } = req.query || {};

    function isValidDate(value) {
      if (typeof value !== "string") return false;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

      const date = new Date(`${value}T00:00:00Z`);

      return !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === value;
    }

    if (!isValidDate(start) || !isValidDate(end)) {
      return res.status(400).json({
        error: "Please provide valid start and end dates"
      });
    }

    if (start > end) {
      return res.status(400).json({
        error: "The start date must be before or equal to the end date"
      });
    }

    // 3. MINUIT À PARIS, AVEC GESTION DU CHANGEMENT D'HEURE

    function parisMidnight(dateString) {
      const reference = new Date(`${dateString}T12:00:00Z`);

      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Paris",
        timeZoneName: "longOffset"
      }).formatToParts(reference);

      const offset = parts.find(
        part => part.type === "timeZoneName"
      )?.value;

      if (!offset || offset === "GMT") {
        return `${dateString}T00:00:00Z`;
      }

      return `${dateString}T00:00:00${offset.replace("GMT", "")}`;
    }

    const nextDay = new Date(`${end}T00:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);

    const endExclusive = nextDay.toISOString().slice(0, 10);

    const startISO = new Date(
      parisMidnight(start)
    ).toISOString();

    const endISO = new Date(
      parisMidnight(endExclusive)
    ).toISOString();

    const searchQuery =
      `created_at:>=${startISO} created_at:<${endISO}`;

    // 4. RÉCUPÉRATION DES COMMANDES ET CALCUL DES VENTES NETTES
    // Sous-total actuel des articles, après remises,
    // hors taxes et frais d'expédition.

    let count = 0;
    let netSales = 0;
    let cursor = null;
    let hasNextPage = true;
    let currencyCode = null;

    while (hasNextPage) {
      const shopifyResponse = await fetch(
        `https://${shop}.myshopify.com/admin/api/2026-07/graphql.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-Shopify-Access-Token": accessToken
          },
          body: JSON.stringify({
            query: `
              query OrdersForPeriod(
                $query: String!,
                $after: String
              ) {
                orders(
                  first: 250,
                  after: $after,
                  query: $query,
                  sortKey: CREATED_AT
                ) {
                  edges {
                    cursor
                    node {
                      currentSubtotalPriceSet {
                        shopMoney {
                          amount
                          currencyCode
                        }
                      }
                    }
                  }
                  pageInfo {
                    hasNextPage
                    endCursor
                  }
                }
              }
            `,
            variables: {
              query: searchQuery,
              after: cursor
            }
          })
        }
      );

      const shopifyText = await shopifyResponse.text();
      let shopifyData;

      try {
        shopifyData = JSON.parse(shopifyText);
      } catch {
        return res.status(500).json({
          error: "Invalid Shopify API response",
          details: shopifyText.substring(0, 500)
        });
      }

      if (!shopifyResponse.ok || shopifyData.errors) {
        return res.status(500).json({
          error: "Shopify API error",
          status: shopifyResponse.status,
          details: shopifyData.errors || shopifyData
        });
      }

      const orders = shopifyData?.data?.orders;

      if (!orders) {
        return res.status(500).json({
          error: "Shopify orders data not found"
        });
      }

      for (const edge of orders.edges) {
        const money =
          edge.node.currentSubtotalPriceSet?.shopMoney;

        if (!money) {
          return res.status(500).json({
            error: "Order subtotal not found"
          });
        }

        const amount = Number(money.amount);

        if (!Number.isFinite(amount)) {
          return res.status(500).json({
            error: "Invalid order amount"
          });
        }

        if (currencyCode && currencyCode !== money.currencyCode) {
          return res.status(500).json({
            error: "Orders use different shop currencies"
          });
        }

        currencyCode = money.currencyCode;
        netSales += amount;
        count++;
      }

      hasNextPage = orders.pageInfo.hasNextPage;
      cursor = orders.pageInfo.endCursor;

      if (hasNextPage && !cursor) {
        return res.status(500).json({
          error: "Shopify pagination cursor missing"
        });
      }
    }

    return res.status(200).json({
      count,
      netSales: Number(netSales.toFixed(2)),
      currency: currencyCode || "EUR",
      start,
      end,
      timezone: "Europe/Paris"
    });

  } catch (error) {
    console.error("Orders API error:", error);

    return res.status(500).json({
      error: "Server error",
      details: error.message
    });
  }
}
