function initOptions() {
  defaultOptions = {
    'autoShow': true,
    'autoShowSelf': true,
    'showTooltips': true,
    'checkMail': true,
    'allowHttps': false,
    'showPageAction': true,
    'openOnAllPages': false
  }

  for (key in defaultOptions) {
    if (localStorage[key] == undefined) {
      localStorage[key] = defaultOptions[key]
    }
  }
}
function Info(url, info) {
  this.init()
  this.info = info
  this.addURL(url)
  console.log('New Info object instaniated', this)
}
Info.prototype = {
  init: function() {
    this.urlList = {}
    this.info = {}
  },
  addURL: function(url) {
    this.urlList[url] = [url, null]
  },
  addVisitItem: function(url, visitItem) {
    this.urlList[url] = [url, visitItem]
  }
}
redditInfo = {
  freshAgeThreshold: 5*60,

  urls: {}, // full of Info objects
  fullname: {
    _shine_demo: {
      title: 'companion bar',
      score: '\u221e',
      num_comments: '7',
      likes: true,
      _fake: true
    }
  },
  fetching: {},
  getURL: function(url) {
    var infoObj = this.getInfo(url)
    return infoObj ? infoObj.info : undefined
  },
  getURLList: function() {
    var urls = []
    for (x in this.urls) {
      for (y in this.urls[x].urlList) {
        urls.push(this.urls[x].urlList[y])
      }
    }
    return urls
  },
  getFullname: function(name) {
    return this.fullname[name]
  },
  getInfo: function(url) {
    for (x in this.urls) {
      if(this.urls[x].urlList[url]) {
        return this.urls[x]
      }
    }
    return undefined
  },
  
  setURL: function(url, info) {
    info._ts = info._ts || Date.now()
    var stored = this.fullname[info.name]
    if (!stored || stored._ts < info._ts) {
      this.urls[url] = new Info(url, info)
      this.fullname[info.name] = info
      console.log('Stored reddit info for', url, info)
    } else {
      console.log('Received info not newer than stored info. Did not store.', stored, info)
    }
  },

  request: function(options) {
    if (!options.data) { options.data = {} }
    options.data['app'] = 'shine'
    $.ajax(options)
  },

  update: function(callback) {
    this.request({
      url: 'http://www.reddit.com/api/me.json',
      success: function(resp) {
        if (resp.data) {
          console.log('Updated reddit user data', resp.data)
          this.storeModhash(resp.data.modhash)
          if (callback) { callback(resp.data) }
        }
      }.bind(this),
      error: function() { callback(false) }
    })
  },

  fetchMail: function(callback) {
    this.request({
      url: 'http://www.reddit.com/message/unread.json',
      success: function(resp) {
        if (resp.data) {
          callback(resp.data.children)
        }
      },
      error: function() { callback(false) }
    })
  },

  _queryInfo: function(params, callback) {
    console.log('Performing AJAX info call for ', params)
    params.limit = 1
    this.request({
      url: 'http://www.reddit.com/api/info.json',
      data: params,
      success: function(resp) {
        if (resp.data) {
          this.storeModhash(resp.data.modhash)
          if (resp.data.children.length) {
            var info = resp.data.children[0].data
            this.setURL(info.url, info)
            barStatus.updateInfo(info)
            callback(info)
          } else {
            callback(null)
          }
        } else {
          callback(false, resp)
        }
      }.bind(this),
      error: function() { callback(false) }
    })
  },
  
  _storedLookup: function(keyName, key, accessor, useStored, callback) {
    // Internal rate limited cached info getter.
    //
    // Look up `key` using `accessor` and call `callback` with the stored data immediately if
    // `useStored` is true and stored info is available. If stored data is
    // currently in the process of being refreshed or it is older than
    // redditInfo.freshAgeThreshold seconds old, false is returned. Otherwise,
    // the data is fetched from reddit and `callback` is invoked with the
    // result.
    var stored = accessor.apply(this, [key]),
        storedAge = 0,
        now = Date.now()
    if (stored) {
      if (useStored) {
        // Return our stored data right away.
        callback(stored)
      }

      if (stored._fake) {
        console.log('Skipping fake info request.')
        return false
      }

      if (this.fetching[stored.name]) {
        console.log('Info already being fetched. Skipping update.', stored)
        return false
      }
    
      var storedAge = Math.floor((now - stored._ts) / 1000)
      if (storedAge < redditInfo.freshAgeThreshold) {
        console.log('Info is', storedAge, 'seconds old. Skipping update.', stored)
        return false
      }

      // Mark that we are fetching the data from reddit
      this.fetching[stored.name] = true
    }

    var queryParams = {age:storedAge}
    queryParams[keyName] = key
    this._queryInfo(queryParams, function() {
      if (stored) { delete this.fetching[stored.name] }
      callback.apply(null, arguments)
    }.bind(this))
    return true
  },

  lookupURL: function(url, useStored, callback) {
    this._storedLookup('url', url, this.getURL, useStored, callback)
  },

  lookupName: function(name, useStored, callback) {
    this._storedLookup('id', name, this.getFullname, useStored, callback)
  },

  _thingAction: function(action, data, callback) {
    if (!this.isLoggedIn()) { callback(false, 'not logged in') }
    
    data.uh = this.modhash
    this.request({
      type: 'POST',
      url: 'http://www.reddit.com/api/'+action,
      data: data,
      success: function(resp) { callback(true) },
      error: function() { callback(false) }
    })
  },

  vote: function(fullname, likes, callback) {
    var dir
    if (likes == true) {
      dir = 1
    } else if (likes == false) {
      dir = -1
    } else {
      dir = 0
    }
    
    this._thingAction('vote', {id:fullname, dir:dir}, callback)
  },

  save: function(fullname, callback) {
    this._thingAction('save', {id:fullname}, callback)
  },

  unsave: function(fullname, callback) {
    this._thingAction('unsave', {id:fullname}, callback)
  },
  
  isLoggedIn: function() {
    // TODO: check for cookie
    return this.modhash != null && this.modhash != ''
  },

  init: function() {
    this.modhash = localStorage['modhash']
  },
    
  storeModhash: function(modhash) {
    localStorage['modhash'] = this.modhash = modhash
  }
}

tabStatus = {
  tabId: {},

  add: function(port) {
    var tabId = port.sender.tab.id,
        tabData = {port:port}
    console.log('Tab added', tabId)
    this.tabId[tabId] = tabData
    port.onDisconnect.addListener(this.remove.bind(this, tabId))
  },

  addBar: function(tabId, bar) {
    var tabData = this.tabId[tabId]
    if (tabData) {
      tabData.bar = bar
    }
  },

  remove: function(tabId) {
    console.log('Tab removed', tabId)
    var fullname = this.tabId[tabId].fullname
    delete this.tabId[tabId]
  },

  send: function(tabId, msg) {
    var tabData = this.tabId[tabId]
    if (tabData) {
      tabData.port.postMessage(msg)
      return true
    } else {
      return false
    }
  },

  _showInfo: function(tabId, fullname) {
    this.send(tabId, {
      action: 'showInfo',
      fullname: fullname
    })
  },
  
  updateTab: function(tabId) {
    var tabData = this.tabId[tabId]
    if (tabData && tabData.bar) {
      console.log('Updating tab', tabId)
      barStatus.update(tabData.bar)
    }
  },

  showInfo: function(tabId, fullname) {
    this._showInfo(tabId, fullname)
  },

  showSubmit: function(tabId) {
    this.send(tabId, {
      action: 'showSubmit'
    })
  }
}

barStatus = {
  fullname: {},
  hidden: {},

  add: function(port, fullname) {
    var barData = {port:port, fullname:fullname}
    console.log('Bar added', barData)
    if (!this.fullname[fullname]) {
      this.fullname[fullname] = []
    }
    this.fullname[fullname].push(barData)
    if (this.hidden[barData.fullname]) {
      delete this.hidden[barData.fullname]
    }
    port.onMessage.addListener(this.handleCommand.bind(this, barData))
    port.onDisconnect.addListener(this.remove.bind(this, barData))
    tabStatus.addBar(port.sender.tab.id, barData)
  },

  remove: function(barData) {
    console.log('Bar removed', barData)
    var fullname = barData.fullname
    if (fullname) {
      var bars = this.fullname[fullname],
          idx = bars.indexOf(barData)
      if (~idx) { bars.splice(idx, 1) }
      if (!bars.length) {
        delete this.fullname[fullname]
      }
    }
  },

  update: function(barData, stored) {
    redditInfo.lookupName(barData.fullname, stored, function(info) {
      if (info == null) { return }
      console.log('Updating bar', barData)
      barData.port.postMessage({
        action: 'update',
        info: info,
        loggedIn: redditInfo.isLoggedIn()
      })
    }.bind(this))
  },
  
  updateInfo: function(info) {
    if (this.fullname[info.name]) {
      this.fullname[info.name].forEach(function(barData) {
        console.log('Sending updated info to bar', barData, info)
        barData.port.postMessage({
          action: 'update',
          info: info,
          loggedIn: redditInfo.isLoggedIn()
        })
      }, this)
    }
  },

  handleCommand: function(barData, msg) {
    console.log('Received message from bar', barData, msg)
    var updateAfter = function(success) {
      if (!success) {
        this.update.bind(this, barData)
      }
    }
    switch (msg.action) {
      case 'update':
        this.update(barData, msg.useStored)
        break
      case 'vote':
        console.log('Voting', msg)
        redditInfo.vote(barData.fullname, msg.likes, updateAfter)
        break
      case 'save':
      case 'unsave':
        console.log('Modifying', msg)
        redditInfo[msg.action](barData.fullname, updateAfter)
        break
      case 'close':
        this.hidden[barData.fullname] = true
        break
    }
  }
}

mailNotifier = {
  lastSeen: null,
  notify: function(messages) {
    var newIdx = null,
        lastSeen = this.lastSeen,
        newCount = 0
    for (var i = 0; i < messages.length; i++) {
      var messageTime = messages[i].data.created_utc*1000
      if (!lastSeen || messageTime > lastSeen) {
        newCount++
        if (!newIdx) { newIdx = i }
        this.lastSeen = Math.max(this.lastSeen, messageTime)
      }
    }

    console.log('New messages: ', newCount)

    var title, text
    if (newCount == 1) {
      var message = messages[newIdx]
      title = message.data.author + ': ' + message.data.subject
      text = message.data.body
    } else if (newCount > 1) {
      title = 'reddit: new messages!'
      text = 'You have ' + messages.length + ' new messages.'
    }

    if (newCount > 0) {
      this.showNotification(title, text)
    }
  },

  clear: function() {
    if (this.notification) {
      this.notification.cancel()
    }
  },

  notification: null,
  showNotification: function(title, text) {
    if (this.notification) {
      this.notification.cancel()
    }

    var n = this.notification =
      webkitNotifications.createNotification('images/reddit-mail.svg', title, text)

    this.notification.onclick = function() {
      window.open('http://www.reddit.com/message/unread/')
      n.cancel()
    }

    this.notification.show()
  }
}

mailChecker = {
  checkInterval: 5*60*1000,

  interval: null,
  start: function() {
    if (!this.interval) {
      console.log('Starting periodic mail check.')
      this.interval = window.setInterval(this.check, this.checkInterval)
      this.check()
    }
  },
  stop: function() {
    if (this.interval) {
      console.log('Stopping periodic mail check.')
      window.clearInterval(this.interval)
      this.interval = null
    }
  },
  check: function() {
    redditInfo.update(function(info) {
      if (info.has_mail) {
        redditInfo.fetchMail(mailNotifier.notify.bind(mailNotifier))
      } else {
        mailNotifier.clear()
      }
    })
  }
}

function setPageActionIcon(tab, info) {
  var pattern = (localStorage['allowHttps'] == 'true') ? /^https?:\/\/.*/ : /^http:\/\/.*/
  if (localStorage['showPageAction'] == 'true' && pattern.test(tab.url)) {
    var iconPath = info ? '/images/reddit.png' : '/images/reddit-inactive.png'
    chrome.pageAction.setIcon({tabId:tab.id, path:iconPath})
    chrome.pageAction.show(tab.id)
  } else {
    chrome.pageAction.hide(tab.id)
  }
}

var workingPageActions = {}
function onActionClicked(tab) {
  if (tab.id in workingPageActions) { return }
  workingPageActions[tab.id] = true

  var frame = 0
  var workingAnimation = window.setInterval(function() {
    try {
      chrome.pageAction.setIcon({tabId:tab.id, path:'/images/working'+frame+'.png'})
    } catch (exc) {
      window.clearInterval(arguments.callee)
    }
    frame = (frame + 1) % 6
  }, 200)
  
  redditInfo.lookupURL(tab.url, true, function(info) {
    window.clearInterval(workingAnimation)
    setPageActionIcon(tab, info)
    delete workingPageActions[tab.id]
    
    if (info) {
      tabStatus.showInfo(tab.id, info.name)
    } else {
      tabStatus.showSubmit(tab.id)
    }
  })
}

chrome.tabs.onSelectionChanged.addListener(tabStatus.updateTab.bind(tabStatus))
chrome.pageAction.onClicked.addListener(onActionClicked)

chrome.extension.onRequest.addListener(function(request, sender, callback) {
  switch (request.action) {
    case 'thingClick':
      console.log('Thing clicked', request)
      redditInfo.setURL(request.url, request.info)
      break
  }
})

function shouldShow(tab, info, data) {
  if (info) {
    if (localStorage['autoShow'] == 'false') {
      console.log('Auto-show disabled. Ignoring reddit page', info)
    } else if (localStorage['autoShowSelf'] == 'false' && info.is_self) {
      console.log('Ignoring self post', info)
    } else if (localStorage['allowHttps'] == 'false' && /^https:\/\/.*/.test(tab.url)) {
      console.log('Https page. Ignoring', info)
    } else if (barStatus.hidden[info.name]) {
      console.log('Bar was closed on this page. Ignoring.', info)
    } else {
      console.log('Recognized page '+tab.url, info)
        return true
      }
    } else {
      var referrer = data,
          redditPattern = /^http:\/\/www\.reddit\.com\/.*/
      if (!redditPattern.test(tab.url) && redditPattern.test(referrer)) {
        console.log("Redirect detected. Attempting to locate associated info.", port)
          handleRedirect(port, tab)
      }
    }
  return false
}
function handleConnect(port) {
  var tag = port.name.split('^')
  var name = tag[0],
      data = tag[1]
  switch (name) {
    case 'overlay':
      tabStatus.add(port)
      var tab = port.sender.tab,
          info = redditInfo.getURL(tab.url)
      setPageActionIcon(tab, info)
      if (localStorage['openOnAllPages'] == 'true') {
        redditInfo.lookupURL(tab.url, false, function(info) {
          if (shouldShow(tab, info, data)) {
            setPageActionIcon(tab, info)
            tabStatus.showInfo(tab.id, info.name)
          }
        })
      } else if (shouldShow(tab, info, data)) {
        tabStatus.showInfo(tab.id, info.name)
      } 
      break
    case 'bar':
      barStatus.add(port, data)
      break
  }
}
chrome.extension.onConnect.addListener(handleConnect)
function getLastVisitItem(url, callback) {
  chrome.history.getVisits({url: url}, function (items) {
    // get the last VisitItem for this URL. We'll assume it's the droid we're looking for.
    callback(items.sort(function(a,b) {b.visitTime - a.visitTime})[0])
  })
}
function handleRedirect(port, tab) {
  getLastVisitItem(tab.url, function(visitItem) {
    var urls = redditInfo.getURLList()
    // urls[i] = ["url_here", null or chrome.history.VisitItem]
    for (i in urls) {
      var currentInfo = redditInfo.getInfo(urls[i][0]),
          url = urls[i][0],
          thisVisitItem = urls[i][1]
      var infoMatched = function() {
        console.log("Located redirected page's info. Trying again.", currentInfo)
        currentInfo.addVisitItem(tab.url, visitItem)
        handleConnect(port)
      }
      if (thisVisitItem == null) {
        getLastVisitItem(url, function (storedVisitItem) {
          currentInfo.addVisitItem(url, storedVisitItem)
          if (storedVisitItem.visitId == visitItem.referringVisitId) {
            infoMatched()
          }
        })
      } else {
        if (thisVisitItem.visitId == visitItem.referringVisitId) {
          infoMatched()
        }
      }
    }
  })
}

function allTabs(callback) {
  // Go through all tabs and do callback with the tab as the only parameter.
  chrome.windows.getAll({populate:true}, function(wins) {
  wins.forEach(function(win) {
    win.tabs.forEach(function(tab) {
      callback(tab)
    })
  })
})
}

// Show page action for existing tabs.
function setAllPageActionIcons() {
  allTabs(function(tab) {
    setPageActionIcon(tab, redditInfo.getURL(tab.url))
  })
}

window.addEventListener('storage', function(e) {
  switch (e.key) {
    case 'checkMail':
      if (e.newValue == 'true') {
        mailChecker.start()
      } else {
        mailChecker.stop()
      }
      break
    case 'allowHttps':
    case 'showPageAction':
      setAllPageActionIcons()
      break
    case 'openOnAllPages':
      if (e.newValue == 'true') {
        allTabs(function(tab) {
          redditInfo.lookupURL(tab.url, true, function(info) {
            if (shouldShow(tab, info)) {
              setPageActionIcon(tab)
              tabStatus.showInfo(tab.id, info.name)
            }
          })
        })
      }
      break
  }
}, false)

initOptions()
console.log('Shine loaded.')
redditInfo.init()
if (localStorage['showPageAction'] == 'true') {
  setAllPageActionIcons()  
}
if (localStorage['checkMail'] == 'true') {
  mailChecker.start()
} else {
  redditInfo.update()
}
