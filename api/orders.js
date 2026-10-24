
export default async function handler(req, res) {
  try {
    const shop = process.env.SHOPIFY_SHOP;
    const clientId = process.env.SHOPIFY_CLIENT_ID;
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

    if (!shop || !clientId || !clientSecret) {
      return res.status(500).json({
        error: "Variables Shopify manquantes."
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

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      return res.status(500).json({
        error: "Authentification Shopify impossible.",
        details: tokenData
      });
    }

    const accessToken = tokenData.access_token;

    // 2. VALIDATION DES DATES
    const { start, end } = req.query || {};

    function isValidDate(value) {
      if (typeof value !== "string") return false;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

      const date = new Date(`${value}T00:00:00.000Z`);

      return !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === value;
    }

    if (!isValidDate(start) || !isValidDate(end)) {
      return res.status(400).json({
        error: "Dates invalides. Format attendu : YYYY-MM-DD."
      });
    }

    if (start > end) {
      return res.status(400).json({
        error: "La date de début doit précéder la date de fin."
      });
    }

    // 3. MINUIT EN HEURE DE PARIS
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
      `created_at:>=${startISO} created_at:<${endISO} -cancelled_at:*`;

    // 4. COMMANDES, VENTES ET ARTICLES
    let count = 0;
    let netSales = 0;
    let cursor = null;
    let hasNextPage = true;
    let currencyCode = null;

    const products = {};

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
                  first: 100,
                  after: $after,
                  query: $query,
                  sortKey: CREATED_AT
                ) {
                  edges {
                    node {
                      currentSubtotalPriceSet {
                        shopMoney {
                          amount
                          currencyCode
                        }
                      }
                      lineItems(first: 250) {
                        nodes {
                          title
                          currentQuantity
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

      const shopifyData = await shopifyResponse.json();

      if (!shopifyResponse.ok || shopifyData.errors) {
        return res.status(500).json({
          error: "Erreur lors de la récupération des commandes Shopify.",
          details: shopifyData.errors || shopifyData
        });
      }

      const orders = shopifyData?.data?.orders;

      if (!orders) {
        return res.status(500).json({
          error: "Données des commandes introuvables."
        });
      }

      for (const edge of orders.edges) {
        const order = edge.node;
        const money = order.currentSubtotalPriceSet?.shopMoney;

        if (money) {
          const amount = Number(money.amount);

          if (!Number.isFinite(amount)) {
            return res.status(500).json({
              error: "Montant de commande invalide."
            });
          }

          if (
            currencyCode &&
            currencyCode !== money.currencyCode
          ) {
            return res.status(500).json({
              error: "Plusieurs devises sont présentes dans les commandes."
            });
          }

          currencyCode = money.currencyCode;
          netSales += amount;
        }

        count++;

        // REGROUPEMENT PAR TITRE DE LIGNE
        // Aucun accès au champ product n'est nécessaire.
        for (const item of order.lineItems?.nodes || []) {
          const productName = item.title;
          const quantity = Number(item.currentQuantity) || 0;

          if (!productName || quantity <= 0) continue;

          if (!Object.prototype.hasOwnProperty.call(products, productName)) {
            products[productName] = 0;
          }

          products[productName] += quantity;
        }
      }

      hasNextPage = orders.pageInfo.hasNextPage;
      cursor = orders.pageInfo.endCursor;

      if (hasNextPage && !cursor) {
        return res.status(500).json({
          error: "Pagination Shopify incomplète."
        });
      }
    }

    // 5. TRI PAR QUANTITÉ VENDUE
    const soldProducts = Object.entries(products)
      .map(([name, quantity]) => ({
        name,
        quantity
      }))
      .sort((a, b) =>
        b.quantity - a.quantity ||
        a.name.localeCompare(b.name)
      );

    return res.status(200).json({
      count,
      netSales: Number(netSales.toFixed(2)),
      currency: currencyCode || "EUR",
      products: soldProducts,
      start,
      end,
      timezone: "Europe/Paris"
    });

  } catch (error) {
    console.error("Orders API error:", error);

    return res.status(500).json({
      error: "Erreur serveur.",
      details: error.message
    });
  }
}
