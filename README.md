# ATV Desktop Remote
A simple menubar app that allows you to control an Apple TV from your desktop

 ![What this application looks like when running in either light or dark mode](screenshot.png)

 ## Update: The latest version works with tvOS 15. It requires Python 3 to be installed on the system to work properly. When the program starts, it will attempt to install the necessary modules for Python to work properly.
 Understand what this means: it will run `pip` to install modules in the default Python user location (no `venv` yet). This program still works as it used to once it is running, but it does use a more complex method for communicating with the Apple TV. The latest version does not have a packaged installer yet, you have to pull it from Github and run `npm start` yourself (at least until it has undergone more testing).

 ## ~~IMPORTANT: tvOS 15 beta is no longer using the protocol that this application uses. If you update to tvOS 15 beta, this app will not work.~~
~~There is promising work at using a different protocol to allow this to continue to work, but until this is implemented don't update to tvOS 15 beta if you want to use this app.~~

 ## Download

[There is a beta version that works with tvOS 15.](https://github.com/bsharper/atv-desktop-remote/releases/tag/v1.0.0-beta). This requires Python 3 to be installed. Please read the information on the release page before installing.

 I've created macOS and Windows releases available here: https://github.com/bsharper/atv-desktop-remote/releases

## Usage

 1. All of the keys are mapped to the keyboard when the application is open (pressing return or enter on the keyboard for select, delete for Menu, etc).
 2. Press `Option` to see what the characters are mapped to when the application is open.


 ## Running

 1. Run `npm install` or `yarn`
 2. Run `npm start` or `yarn start`
 3. The application runs in the menubar. Look for a tiny remote icon and click on it. Right-click for more options.
 4. The first time the app runs it will need to pair with an Apple TV. You can pair with more than one.
 5. Press `Cmd+Shift+R` to open the application from anywhere. On Windows its `Ctrl+Shift+R`

## Building

1. `electron-builder` is used to create a standalone application.

## Notes

This is cobbled together from a few projects I've worked on. It works well enough for me for daily use, so I figured others might like it.
