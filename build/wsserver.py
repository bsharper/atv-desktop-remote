import os
import sys
import json
import pyatv
import random
import asyncio
from pyatv.const import InputAction
import websockets

import logging
logger = logging.getLogger('websockets')
logger.setLevel(logging.DEBUG)
logger.addHandler(logging.StreamHandler())


interface = pyatv.interface
pair = pyatv.pair
Protocol = pyatv.const.Protocol


my_name = os.path.basename(sys.argv[0])

try:
    loop = asyncio.get_event_loop()
except RuntimeError:
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

scan_lookup = {}
filter_atvs = True # Should only return ATVs and not other device types (HomePods, Macs, etc)
pairing_atv = False
active_pairing = False
active_device = False
active_remote = False
active_ws = False
default_port = 8765
pairing_creds = {}

class ATVKeyboardListener(interface.KeyboardListener):
    global active_ws
    def focusstate_update(self, old_state, new_state):
        print('Focus state changed from {0:s} to {1:s}'.format(old_state, new_state), flush=True)
        if active_ws:
            try:
                loop.run_until_complete(sendCommand(active_ws, "keyboard_changestate", [old_state, new_state]))
            except Exception as ex:
                print (f"change state error: {ex}", flush=True)
                


async def sendCommand (ws, command, data=[]):
    r = {"command": command, "data": data}
    await ws.send(json.dumps(r))

async def parseRequest(j, websocket):
    global scan_lookup, pairing_atv, active_pairing, active_device, active_remote, active_ws, pairing_creds
    active_ws = websocket
    if "cmd" in j.keys():
        cmd = j["cmd"]
    else:
        return
    #print (f"got command: {cmd}", flush=True)
    
    data = False
    if "data" in j.keys():
        data = j["data"]
    
    if cmd == "quit":
        print ("quit command")
        await asyncio.sleep(0.5)
        sys.exit(0)
        return
    
    if cmd == "scan":
        atvs = await pyatv.scan(loop)
        ar = []
        scan_lookup = {}
        if filter_atvs:
            atvs = [ "TV" in x.device_info.model_str for x in atvs]
        for atv in atvs:
            txt = f"{atv.name} ({atv.address})"
            ar.append(txt)
            scan_lookup[txt] = atv

        await sendCommand(websocket, "scanResult", ar)

    if cmd == "echo":
        await sendCommand(websocket, "echo_reply", data)

    if cmd == "startPair":
        print ("startPair")
        atv = scan_lookup[data]
        pairing_atv = atv
        print ("pairing atv %s" % (atv))
        pairing = await pair(atv, Protocol.AirPlay, loop)
        active_pairing = pairing
        await pairing.begin()

    if cmd == "finishPair1":
        print("finishPair %s" % (data))
        pairing = active_pairing
        pairing.pin(data)
        await pairing.finish()
        if pairing.has_paired:
            print("Paired with device!")
            print("Credentials:", pairing.service.credentials)
        else:
            print("Did not pair with device!")
            return
        creds = pairing.service.credentials
        id = pairing_atv.identifier
        nj = {"credentials": creds, "identifier": id}
        pairing_creds = nj
        await sendCommand(websocket, "startPair2")
        #await sendCommand(websocket, "pairCredentials1", nj)
        atv = pairing_atv
        print ("pairing atv %s" % (atv))
        pairing = await pair(atv, Protocol.Companion, loop)
        active_pairing = pairing
        await pairing.begin()

    if cmd == "finishPair2":
        print("finishPair %s" % (data))
        pairing = active_pairing
        pairing.pin(data)
        await pairing.finish()
        if pairing.has_paired:
            print("Paired with device!")
            print("Credentials:", pairing.service.credentials)
        else:
            print("Did not pair with device!")
        pairing_creds["Companion"] = pairing.service.credentials
        await sendCommand(websocket, "pairCredentials", pairing_creds)
    
    
    if cmd == "finishPair":
        print("finishPair %s" % (data))
        pairing = active_pairing
        pairing.pin(data)
        await pairing.finish()
        if pairing.has_paired:
            print("Paired with device!")
            print("Credentials:", pairing.service.credentials)
        else:
            print("Did not pair with device!")
        creds = pairing.service.credentials
        id = pairing_atv.identifier
        nj = {"credentials": creds, "identifier": id}
        await sendCommand(websocket, "pairCredentials", nj)

    if cmd == "kbfocus":
        if not active_device:
            return
        kbfocus = active_device.keyboard.text_focus_state == pyatv.const.KeyboardFocusState.Focused
        await sendCommand(websocket, "kbfocus-status", kbfocus)
    
    if cmd == "settext":
        text = data["text"]
        if active_device.keyboard.text_focus_state != pyatv.const.KeyboardFocusState.Focused:
            return
        await active_device.keyboard.text_set(text)
    
    if cmd == "gettext":
        print (f"gettext focus compare {active_device.keyboard.text_focus_state} == {pyatv.const.KeyboardFocusState.Focused}", flush=True)
        if active_device.keyboard.text_focus_state != pyatv.const.KeyboardFocusState.Focused:
            return
        ctext = await active_device.keyboard.text_get()
        print (f"Current text: {ctext}", flush=True)
        await sendCommand(websocket, "current-text", ctext)
    
    if cmd == "connect":
        id = data["identifier"]
        creds = data["credentials"]
        stored_credentials = { Protocol.AirPlay: creds }
        if "Companion" in data.keys():
            companion_creds = data["Companion"]
            stored_credentials[Protocol.Companion] = companion_creds
        
        print ("stored_credentials %s" % (stored_credentials))
        atvs = await pyatv.scan(loop, identifier=id)
        atv = atvs[0]
        for protocol, credentials in stored_credentials.items():
            print ("Setting protocol %s with credentials %s" % (str(protocol), credentials))
            atv.set_credentials(protocol, credentials)
        try:
            device = await pyatv.connect(atv, loop)
            remote = device.remote_control
            active_device = device
            active_remote = remote
            kblistener = ATVKeyboardListener()
            device.keyboard.listener = kblistener
            await sendCommand(websocket, "connected")
        except Exception as ex:
            print ("Failed to connect")
            await sendCommand(websocket, "connection_failure")
    
    if cmd == "is_connected":
        ic = "true" if active_remote else "false"
        await sendCommand(websocket, "is_connected", ic)
        #await active_remote.menu()
    
    if cmd == "key":
        valid_keys = ['play_pause', 'left', 'right', 'down', 'up', 'select', 'menu', 'top_menu', 'home', 'home_hold', 'skip_backward', 'skip_forward', 'volume_up', 'volume_down']
        no_action_keys = ['volume_up', 'volume_down', 'play_pause', 'home_hold']
        #taction = InputAction["SingleTap"]
        taction = False
        key = data
        if not isinstance(data, str):
            key = data['key']
            taction = InputAction[data['taction']]
    
        if key in valid_keys:
            if key in no_action_keys or (not taction):
                r = await getattr(active_remote, key)()
            else:
                r = await getattr(active_remote, key)(taction)
            #print (r)

async def close_active_device():
    try:
        if active_device:
            await active_device.close()
    except Exception as ex:
        print ("Error closing active_device: %s" %(ex))

async def reset_globals():
    global scan_lookup, pairing_atv, active_pairing, active_device, active_remote, active_ws
    print ("Resetting global variables")
    scan_lookup = {}
    
    pairing_atv = False
    active_pairing = False
    active_device = False
    active_remote = False
    active_ws = False

keep_running = True


async def check_exit_file():
    global keep_running
    if os.path.exists('stopserver'):
        os.unlink('stopserver')

    while keep_running:
        await asyncio.sleep(0.5)
        fe = os.path.exists('stopserver')
        txt = "found" if fe else "not found"
        #print ("stopserver %s" % (txt), flush=True)
        if fe:
            print ("exiting")
            keep_running = False
            os.unlink('stopserver')
            sys.exit(0)


async def ws_main(websocket):
    #await reset_globals()
    await close_active_device()
    async for message in websocket:
        try:
            j = json.loads(message)
        except Exception as ex:
            print ("Error parsing message: %s\n%s" % (str(ex), message))
            continue
        
        await parseRequest(j, websocket)

async def main(port):
    global keep_running
    width = 80
    txt = "%s WebSocket - ATV Server" % (my_name)
    print ("="*width)
    print (txt.center(width))
    print ("="*width, flush=True)
    task = asyncio.create_task(check_exit_file())

    async with websockets.serve(ws_main, "localhost", port):
        try:
            await asyncio.Future()  # run forever
        except Exception as ex:
            print (ex)
            sys.exit(0)



if __name__ == "__main__":
    args = sys.argv[1:]
    port = default_port
    if len(args) > 0:
        if args[0] in ["-h", "--help", "-?", "/?"]:
            print ("Usage: %s (port_number)\n\n Port number by default is %d" % (my_name, default_port))
        port = int(args[0])

    asyncio.set_event_loop(loop)
    loop.run_until_complete(main(port))

