import json
import sys

args = sys.argv[1:]

build_pkg = json.load(open('package.json'))
ver = build_pkg['version']
app_pkg = json.load(open('app/package.json'))
appver = app_pkg['version']

if len(args) > 0:
	newver = args[0]
else:
	newver = ver

build_pkg['version'] = newver
app_pkg['version'] = newver


json.dump(app_pkg, open('app/package.json', 'w'), indent=4)
json.dump(build_pkg, open('package.json', 'w'), indent=4)

