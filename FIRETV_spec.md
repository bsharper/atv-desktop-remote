# FireTVRest
I was searching for a faster way to control my FireTV 4k Max gen 2 stick and could only find the abd controls. After much trial and error I was able to packet sniff the commands that the FireTV remote app uses to communicate. Below are my findings to hopefully help others.

# Pin Verification
In order to control the FireTV by HTTP we will need to acquire a token. To get the token we must first complete the pin verification process with the FireTV. The first step is to wake the FireTV with either the remote or sending a POST command.
```
POST http://firetvip:8009/apps/FireTVRemote
```
Once the FireTV is awake we can proceed with requesting the pin.
```
curl -k https://firetvip:8080/v1/FireTV/pin/display \
  -H "X-Api-Key: 0987654321" \
  -H "Content-Type: application/json" \
  -d '{"friendlyName": "ha\'s Fire TV"}'
```
The FireTV will now display a 4 digit pin code. We will send that `pin` with the following command to get the token we will need.
```
curl -k https://firetvip:8080/v1/FireTV/pin/verify \
  -H "X-Api-Key: 0987654321" \
  -H "Content-Type: application/json" \
  -d '{"pin":"xxxx"}'
```
This will output something like `{"description":"Wj9PP8I"}`. Save this token as we will be using it for the control.
There are 3 different different types of controls that the FireTV uses.

# 1. Media Control
To use the media controls you need to use the `https://firetvip:8080/v1/media?action=state` url.
To play/pause.
```
curl -X POST -k https://firetvip:8080/v1/media?action=play \
  -H "X-Api-Key: 0987654321" \
  -H "X-Client-Token: token" \
  -H "user-agent: okhttp/4.10.0" \
  -H "Content-Type: application/json; charset=utf-8" \
```
To Fast Forward
```
curl -X POST -k https://firetvip:8080/v1/media?action=scan \
  -H "X-Api-Key: 0987654321" \
  -H "X-Client-Token: token" \
  -H "user-agent: okhttp/4.10.0" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d '{"direction":"forward", "keyAction":{"keyActionType":"keyDown"}}'
```
To Rewind
```
curl -X POST -k https://firetvip:8080/v1/media?action=scan \
  -H "X-Api-Key: 0987654321" \
  -H "X-Client-Token: token" \
  -H "user-agent: okhttp/4.10.0" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d '{"direction":"back", "keyAction":{"keyActionType":"keyDown"}}'
```
# 2. Main Controls
The main controls use the `https://firetvip:8080/v1/FireTV?action=state` url.
```
curl -X POST -k https://firetvip:8080/v1/FireTV?action=state \
  -H "X-Api-Key: 0987654321" \
  -H "X-Client-Token: token" \
  -H "user-agent: okhttp/4.10.0" \
  -H "Content-Type: application/json; charset=utf-8" \
```
The usable commands for `state` are:
```
Left = dpad_left
Right = dpad_right
UP = dpad_up
Down = dpad_down
Select = select
Home = home
Back = back
Menu = menu
```
# 3. App Launcher
The app launcher control uses the `https://firetvip:8080/v1/FireTV/app/appid` url.
```
curl -X POST -k https://firetvip:8080/v1/FireTV/app/appid \
  -H "X-Api-Key: 0987654321" \
  -H "X-Client-Token: token" \
  -H "user-agent: okhttp/4.10.0" \
  -H "Content-Type: application/json; charset=utf-8" \
```
Below are some of the tested appids:
```
Disney Plus = com.disney.disneyplus
Youtube = com.amazon.firetv.youtube
Netflix = com.netflix.ninja
Prime Video = com.amazon.cloud9
Amazon Music = com.amazon.bueller.music
Pandora = com.pandora.android.gtv
Hulu = com.hulu.plus
BBC = uk.co.bbc.iplayer
NowTV = com.bskyb.nowtv.beta
AppleTV = com.apple.atve.amazon.appletv
ITV = air.ITVMobilePlayer
Chan 4 = com.channel4.ondemand
Demand 5 = com.mobileiq.demand5
SkyNews = com.onemainstream.skynews.android
```
