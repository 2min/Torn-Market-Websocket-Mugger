# Install

1) Download this code from Github (green Code dropdown, then Download ZIP).
2) Unzip it
3) Edit the top lines of background.js, settings TORN_API_KEY to a public API key (and adjust minimum_in_hand_for_ping if desired).
4) Load as an unpacked extension (see https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked)
5) Navigate to an item market page which displays in an auto-updating list view format, like [Xanax](https://www.torn.com/page.php?sid=ItemMarket#/market/view=search&itemID=206&itemName=Xanax&itemType=Drug) or [Donator Packs](https://www.torn.com/page.php?sid=ItemMarket#/market/view=search&itemID=283&itemName=Donator%20Pack&itemType=Supply%20Pack)
6) Click the Chrome Extension button to activate this extension (if done correctly, you'll see a message at the top of your screen that says "Torn Market Websocket Mugger started debugging this browser")
7) [Optional] Refresh the item market page you have open, so it issues a new API call. The extension will use that API call to pre-load the database of monitored items. If you don't do this, it will gradually load over time from websocket pings.
8) You'll receive chrome notifications for mug events, which show up for 10 seconds. Clicking one will take you to an attack page for that person. Attack, and mug. If unsuccessful, you were too slow.



