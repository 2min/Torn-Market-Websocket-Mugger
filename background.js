// Config
const TORN_API_KEY = 'REPLACE_ME_WITH_PUBLIC_API_KEY';
const minimum_in_hand_for_ping = 20000000; // Minimum amount in dollars to trigger notification

// These are either too strong, or know what they are doing and a waste of 25e
const blacklistedSellerIDs = [204836, 198133, 1441750, 2200729, 2660552, 2587660, 1466443, 2057854, 2695126, 1000524, 674469];

let monitoringItemID = null; // Determined by url of tab when you activate addon
let monitoredItems = {}; // Global hash table to store items by listingID

// Activate extension on current tab when extension button is clicked
chrome.action.onClicked.addListener(async (tab) => {
    console.log('Active tab URL:', tab.url);
    
    // Extract itemID from URL
    const url = new URL(tab.url);
    const params = new URLSearchParams(url.hash.slice(1));
    const itemID = params.get('itemID');
    monitoringItemID = itemID; // Store itemID in global variable
    console.log('Actively Monitoring Item ID:', itemID);
    
    try {
        // Reset monitored items (will be re-populated via page refresh and then websockets)
        monitoredItems = {};
        console.log('Items cleared successfully');
        
        // Attach the debugger to the current tab.
        await chrome.debugger.attach({ tabId: tab.id }, "1.3");

        // Enable network events in the debug protocol
        await chrome.debugger.sendCommand({ tabId: tab.id }, "Network.enable", {});

    } catch (err) {
        console.error("Failed to attach debugger:", err);
    }
});

// Listen to Torn Websocket and Torn API call events
chrome.debugger.onEvent.addListener(async (source, method, params) => {
  // We only care about events coming from the attached tab
  if (!source.tabId) return; 

  switch (method) {

    case "Network.webSocketFrameReceived":
      // Websocket payload from Torn

      try {
        const data = JSON.parse(params.response.payloadData);

        // We're monitoring a specific item, ignore all other websocket messages
        if (data?.result?.channel === "item-market_"+monitoringItemID) {

            const message = data.result.data.data.message;

            // Websocket - new item added!
            if (message?.action === 'add') {
              // {"channel":"item-market_206","message":{"namespace":"item-market","action":"add","data":{"ID":13686343,"anonymous":false,"status":"online","user":{"ID":3533826,"name":"GirthControl","honorID":1076,"honorStyle":"default"},"faction":{"ID":11376,"name":"AI","imageUrl":"https://factiontags.torn.com/11376-45863.png","rank":"gold"},"price":795000,"available":2}}}
              const listingData = message.data;
              if (listingData) {
                const itemDetails = {
                  listingID: listingData.ID,
                  price: listingData.price,
                  sellerID: listingData.user?.ID || 0,
                  available: listingData.available,
                };
                console.log('[Listing Added]', { ...itemDetails, timestamp: Math.floor(Date.now() / 1000) });
                monitoredItems[itemDetails.listingID] = itemDetails;
                console.log("New item stored successfully:", itemDetails);
              }
            }

            // Websocket - item removed!
            if (message?.action === 'remove') {
              // {"channel":"item-market_206","message":{"namespace":"item-market","action":"remove","data":{"listingID":13686343}}}
              const listingID = message.data.listingID;
              try {
                const item = monitoredItems[listingID];
                if (item) {
                  var total_dollars = item.available * item.price;

                  console.log('[Listing Removed]', Math.floor(Date.now() / 1000), {
                    listingID: item.listingID,
                    price: item.price,
                    sellerID: item.sellerID,
                    available: item.available,
                    total_dollars: total_dollars,
                    'over_20m': total_dollars > 20000000,
                    timestamp: Math.floor(Date.now() / 1000)
                  });

                  await do_mug_notification(item, total_dollars);
                  
                  // Delete the item
                  delete monitoredItems[listingID];

                } else {
                  console.log('[Listing Removed] No entry found for listingID:', listingID);
                }
              } catch (error) {
                console.error('[Listing Removed] Error retrieving listing data:', error);
              }
            }

            // Websocket - item updated!
            if (message?.action === 'update') {
              // {"channel":"item-market_206","message":{"namespace":"item-market","action":"update","data":{"listingID":13685914,"available":273}}}
              const listingID = message.data.listingID;
              // No listing ID in payload, e.g. is of this form: { "namespace": "item-market", "action": "update", "data": { "itemID": 206, "minPrice": 821000 } }
              if(listingID) {
                try {
                  const item = monitoredItems[listingID];
                  if (item) {
                    var how_many_removed = item.available - message.data.available;
                    var total_dollars = how_many_removed * item.price;

                    console.log('[Listing Updated]', Math.floor(Date.now() / 1000), {
                      listingID: item.listingID,
                      price: item.price,
                      sellerID: item.sellerID,
                      available: message.data.available,
                      total_dollars: total_dollars,
                      'over_20m': total_dollars > 20000000,
                      'how_many_removed': how_many_removed,
                      timestamp: Math.floor(Date.now() / 1000)
                    });

                    await do_mug_notification(item, total_dollars);

                    // Update the stored item with new available quantity
                    monitoredItems[listingID] = {
                      listingID: item.listingID,
                      price: item.price,
                      sellerID: item.sellerID,
                      available: message.data.available
                    };

                  } else {
                    console.log('[Listing Updated] No entry found for listingID:', listingID);
                  }
                } catch (error) {
                  console.error('[Listing Updated] Error retrieving listing data:', error);
                }
              }
            }

        }
      } catch (error) {
        // Silently ignore parsing errors as not all frames will be JSON or have the expected structure
      }
      break;

    case "Network.responseReceived":
      // API payload from Torn
      const { requestId, response } = params;
    
      if (response.url.includes("https://www.torn.com/page.php?sid=iMarket&step=getListing")) {
        try {
          // First get the request POST data
          const requestData = await chrome.debugger.sendCommand(
            { tabId: source.tabId },
            "Network.getRequestPostData",
            { requestId }
          );
          console.log("[getListing] Request POST data:", requestData);

          // Check if this is a request for the monitored item
          const formData = requestData.postData.replace(/\r\n|\r|\n/g, '\n').trim();
          const matches = formData.match(/name="itemID"\s*\n\s*(\d+)/);
          const itemID = matches ? parseInt(matches[1]) : null;
          if (itemID != monitoringItemID) {
            console.log(`[getListing] Skipping non-tracking item: ${itemID}`);
            return;
          }

          // Then proceed with getting response body
          const { body, base64Encoded } = await chrome.debugger.sendCommand(
            { tabId: source.tabId },
            "Network.getResponseBody",
            { requestId }
          );
          
            const responseData = JSON.parse(base64Encoded ? atob(body) : body);
            //{ "list": [ { "ID": 13686641, "anonymous": false, "status": "online", "user": { "ID": 2676398, "name": "Dalmont", "honorID": 127, "honorStyle": "default" }, "faction": { "ID": 51576, "name": "CO", "imageUrl": "https:\/\/factiontags.torn.com\/51576-47756.png", "rank": "bronze" }, "price": 832000, "available": 24 } ]}

            if (responseData?.list && Array.isArray(responseData.list)) {
              const currentTime = Math.floor(Date.now() / 1000);
              for (const listingData of responseData.list) {
                if (listingData.ID) {
                  const itemDetails = {
                    listingID: listingData.ID,
                    price: listingData.price,
                    sellerID: listingData.user?.ID || 0,
                    available: listingData.available,
                  };
                  monitoredItems[itemDetails.listingID] = itemDetails;
                  console.log(`[getListing] Processed item: ListingID ${listingData.ID}, SellerID ${itemDetails.sellerID}`);
                }
              }
            }

        } catch (error) {
          console.error("Failed to get response body:", error);
        }
      }
      break;

    default:
      break;
  }
});

async function do_mug_notification(item, total_dollars) {

  // No need to ping for Anon sellers
  if (!item.sellerID) {
    console.log('[Anonymous Seller]', {
      listingID: item.listingID,
      price: item.price,
      sellerID: item.sellerID,
      available: item.available,
      total_dollars: total_dollars
    });
    return;
  } 

  // No need to ping for blacklisted sellers
  if (blacklistedSellerIDs.includes(item.sellerID)) {
    console.log('[Blacklisted Seller]', {
      listingID: item.listingID,
      price: item.price,
      sellerID: item.sellerID,
      available: item.available,
      total_dollars: total_dollars
    });
    return;
  } 

  // Only ping if muggable amount surpasses threshold
  if (total_dollars > minimum_in_hand_for_ping) {

    // Make API call to check on user
    try {
      const response = await fetch(`https://api.torn.com/user/${item.sellerID}?selections=profile&key=${TORN_API_KEY}`);
      const userData = await response.json();
      
      // Here we want to filter out the "noise"

      // You could do something like a check and see if the player hasn't been active in the last X minutes
      //const timeAFK = Math.floor(Date.now() / 1000) - userData.last_action.timestamp;
      //if (timeAFK > 60) { // More than 1 minute since last action

      // For now, we'll just ensure the player is attackable with a state check
      if (userData.status.state == "Okay") { 
        const notificationId = `mug-${item.sellerID}`;
        const attackUrl = `https://www.torn.com/loader.php?sid=attack&user2ID=${item.sellerID}`;
        
        const notificationMessage = `${userData.name} may have ${total_dollars.toLocaleString()} on hand!`;
        
        console.log('Notification message:', Math.floor(Date.now() / 1000), notificationMessage);

        chrome.notifications.create(notificationId, {
          type: 'basic',
          iconUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==', //1x1 blank pixel
          title: 'Potential Mug Target',
          message: notificationMessage,
          requireInteraction: false,
          silent: false
        });

        // Set timeout to clear notification after 10 seconds
        setTimeout(() => {
          chrome.notifications.clear(notificationId);
        }, 10000);

        // Add click listener for notification, which opens attack page on target
        chrome.notifications.onClicked.addListener(function(clickedId) {
          if (clickedId === notificationId) {
            chrome.tabs.create({ url: attackUrl });
            chrome.notifications.clear(clickedId);
          }
        });
      }
    } catch (error) {
      console.error("Error checking user last action:", error);
    }
  }
}