// Connecting to MySql
var mysql = require('mysql');

var connection = mysql.createConnection({
	host: "localhost",
	port: "8889",
	user: "root",
	password: "root",
	database: "PriCoSha"
});

connection.connect(function(err) {
	if (err) throw err;
	console.log("Connected to database");
});

// Creating web server
var http = require("http");
var express = require("express");
var app = express();
app.set('view engine', 'ejs');  
var bodyParser = require('body-parser');
var md5 = require('md5');
var session = require('express-session');

// Start of web application
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({secret: 'secret-token-here', resave: false, saveUninitialized: false}));

// Login page
app.get('/', function(req, res) {
	if (typeof req.session.username !== 'undefined') return res.redirect('/home');
	// Check if err by checking req.session 
	var err = (typeof req.session.err !== 'undefined' && req.session.err !== null) ? req.session.err : null; 
	// Clear err once checked
	req.session.err = null
	var error = (err !== null); 
	res.render('index', {error: error, err: err});
});

// Attempting to login
app.post('/loginAuth', function(req, res) {
	var username = req.body.username;
	var password = md5(req.body.password);
	var query = "SELECT * FROM Person WHERE username = ? AND password = ?";
	connection.query(query, [username, password], function(err, rows, fields) {
		// No user exists, render error message
		if (rows.length === 0) {
			req.session.err = "The username or password you entered is incorrect."
			res.redirect('/')
		} else {
			var session = req.session;
			session.username = username;
			res.redirect('/home');
		}
	});
	return;
});

// Registering new user 
app.get('/register', function(req, res) {
	if (typeof req.session.username !== 'undefined') return res.redirect('/home');
	// Check if there's an error in req.session.err
	var err = (typeof req.session.err !== 'undefined' && req.session.err !== null) ? req.session.err : null; 
	// Clear err once checked
	req.session.err = null; 
	var error = (err !== null); 
	res.render('register', {error: error, err: err});
})

// Attempting to register new user
app.post('/registerAuth', function(req, res) {
	var firstName = req.body.first_name;
	var lastName = req.body.last_name;
	var username = req.body.username;
	var password = req.body.password;
	var hashedPassword = md5(password);

	var query = "SELECT * FROM Person WHERE username = ?";
	connection.query(query, username, function(err, rows, fields) {
		// Username already exists
		if (rows.length > 0) {
			req.session.err = "This username is already registered.";
			res.redirect('/register');
		} else {
			// Username does not exist, insert into database
			var query = "INSERT INTO Person (username, password, first_name, last_name) Values (?, ?, ?, ?)";
			connection.query(query, [username, hashedPassword, firstName, lastName], function(err, rows, fields) {
				if (err) throw err;
				var session = req.session;
				session.username = username;
				res.redirect('/home');
			});
		}
	})
	return;
})

// Home page of user
// Gets contents from FriendGroups that user is a member of and contents that are visible to user
app.get('/home', function(req, res) {
	// If not logged in, redirect to index page
	if (typeof req.session.username === 'undefined') return res.redirect('/');
	var username = req.session.username;
	// TODO: if shared to more than one group that user belongs to, show groups in 'shared from:'
	displayHomePage(username)
		.then((homePage) => {
			// Check if there is a success message and err message
			req.session.FriendGroups = homePage.groups;
			homePage.success = req.session.success;
			homePage.err = req.session.err; 
			homePage.error = (typeof homePage.err !== 'undefined' && homePage.err !== null);
			// Clear success and error message afterwards
			req.session.success = null;
			req.session.err = null;
			res.render('home', homePage);
		})
})

// Filter home page content by groupName
app.get('/home/:creator/:groupName', function(req, res) {
	if (typeof req.session.username === 'undefined') return res.redirect('/');
	var groupName = req.params.groupName;
	var creator = req.params.creator;
	var username = req.session.username;
	displayHomePage(username)
		.then((homePage) => {
			// Check if there is a success message and err message
			req.session.FriendGroups = homePage.groups;
			homePage.success = req.session.success;
			homePage.err = req.session.err; 
			homePage.error = (typeof homePage.err !== 'undefined' && homePage.err !== null);
			// Clear success and error message afterwards
			req.session.success = null;
			req.session.err = null;
			// Filter content by groupName or public
			var showContent;
			if (groupName === 'public') {
				showContent = homePage.contents.filter((content) => content.public === 1);
			} else {
				showContent = homePage.contents.filter((content) => {
					var index = (content.group_name !== null) ? content.group_name.indexOf(groupName) : -1;
					return (index !== -1 && content.username_creator[index] === creator);
				})
			}
			homePage.contents = showContent;
			res.render('home', homePage);
		})
})

function displayHomePage(username) {
	var homePage = {
		error: false,
		err: null,
		success: null, 
		username: username
	};

	return Promise.all([getContents(username), getFriendGroups(username)])
		.then((results) => {
			homePage.contents = results[0];
			checkDuplicateIds(homePage.contents);
			homePage.groups = results[1];
			return homePage; 
		})
}

// Gets contents shared to FriendGroups user is a member of 
// Or contents that are public to everyone 
function getContents(username) {
	var query = "SELECT Content.*, Share.username AS username_creator, group_name " +
				"FROM Content LEFT JOIN Share USING (id) WHERE Content.public IS true " +
				"OR (group_name, Share.username) IN " +
				"(SELECT group_name, username_creator FROM Member WHERE username = ?)" +
				"ORDER BY timest DESC"
	return new Promise((resolve, reject) => {
		connection.query(query, username, function(err, rows, fields) {
			if (err) return reject(err);
			rows.forEach((row) => {
				if (row.username_creator !== null) {
					row.username_creator = new Array(row.username_creator); 
					row.group_name = new Array(row.group_name);
				}
			})
			resolve(rows);
		})
	})
}

// If content is shared to more than one group that user is a member of,
// add the group_name, username to the first occurence of the content 
function checkDuplicateIds(contents) {
	return contents.map((content, index) => {
		for (var i = contents.length - 1; i > index; i--) {
			var creatorsArray = content.username_creator;
			var groupNames = content.group_name; 
			if (contents[i].id === content.id) {
				creatorsArray.push(contents[i].username_creator[0]);
				groupNames.push(contents[i].group_name[0]);
				contents.splice(i, 1);
			} 
		}
	})
}

// Gets FriendGroups that user is a member of (includes FriendGroups user has created)
function getFriendGroups(user) {
	var query = "SELECT Member.username, FriendGroup.group_name, username_creator, description " +
				"FROM Member, FriendGroup WHERE FriendGroup.group_name = Member.group_name " +
				"AND Member.username_creator = FriendGroup.username AND Member.username = ?";
	return new Promise((resolve, reject) => {
		connection.query(query, [user, user], (err, rows) => {
			if (err) return reject(err);
			if (rows.length === 0) resolve(null);
			else { resolve(rows); }
		});
	})
}

// User is adding content and sharing to FriendGroup(s) or making it public
app.post('/share-content', function(req, res) {
	var username = req.session.username;
	var file_path = req.body.file_path;
	var content_name = req.body.content_name;
	var isTagged = req.body.tag;
	var friendGroups = (Array.isArray(req.body.group_name)) ? req.body.group_name : new Array(req.body.group_name);
	var isPrivate = req.body.isPrivate;

	createContent(username, file_path, content_name, isPrivate)
		.then((id) => {
			if (isPrivate === 'on') {
				var promises = friendGroups.map((group) => shareContent(id, group));
				return Promise.all(promises);
			} else {
				return null; 
			}
		})
		.then(() => {
			req.session.success = "You have successfully shared your content";
			res.redirect('/home');
		})
})

// Insert content into Content database
function createContent(username, file_path, content_name, isPrivate) {
	var isPublic = !(isPrivate === 'on');
	var query = "INSERT INTO Content(id, username, file_path, content_name, public) VALUES (?, ?, ?, ?, ?)";
	return new Promise ((resolve, reject) => {
		connection.query(query, [null, username, file_path, content_name, isPublic], (err, rows) => {
			if (err) return reject(err);
			resolve(rows.insertId);
		});
	})
}

// Insert content into Share database
function shareContent(id, group) {
	var groupInfo = group.split(':');
	var groupName = groupInfo[0];
	var creator = groupInfo[1];
	var query = "INSERT INTO Share(id, group_name, username) VALUES (?, ?, ?)";
	return new Promise ((resolve, reject) => {
		connection.query(query, [id, groupName, creator], (err, rows) => {
			if (err) return reject(err);
			resolve(rows);
		})
	})
}

// User is creating a new FriendGroup and adding at least one member to FriendGroup
// If FriendGroup already exists, display warning message
// If member that user is trying to add to FriendGroup does not exist, display warning message
app.post('/create-group', function(req, res) {
	var creator = req.session.username;
	var groupName = req.body.group_name;
	var description = req.body.description;
	var members = req.body.members.split(',');
	members.push(creator);

	var promises = members.map((member) => checkUserExists(member));
	promises.push(checkGroupNotExists(creator, groupName));

	return Promise.all(promises)
		.then((errStrings, error) => {
			// If no errors, create FriendGroup
			if (checkAnyErrors(errStrings) === false) {
				createFriendGroup(creator, groupName, description);
				members.map((member) => addMemberToGroup(member, groupName, creator)); 
				req.session.success = "You have successfully created the FriendGroup " + groupName;
				res.redirect('/home');
			} else {
				req.session.err = errStrings;
				res.redirect('/home');
			}
		});
})

// Check if member that user is trying to add to FriendGroup exists
// If user exists, returns null
// Checking using username 
function checkUserExists(member) {
	var query = "SELECT * FROM Person WHERE username = ?";
	return new Promise((resolve, reject) => {
		connection.query(query, member, (err, rows) => {
			if (err) return reject(err);
			if (rows.length === 0) {
				var errString = "The user " + member + " does not exist";
				resolve(errString);
			} else {
				resolve(null);
			}
		});
	})
}

// Check if group already exists in FriendGroup data base
// If no existing FriendGroup, returns null
function checkGroupNotExists(username, groupName) {
	var query = "SELECT * FROM FriendGroup WHERE username = ? AND group_name = ?";
	return new Promise((resolve, reject) => {
		connection.query(query, [username, groupName], (err, rows) => {
			if (err) return reject(err);
			if (rows.length !== 0) {
				var errString = "You already have a FriendGroup named " + groupName; 
				resolve(errString);
			} else {
				resolve(null);
			}
		})
	})
}

// If every item in errArray is null, then there are no errors
// Returns false if no errors 
function checkAnyErrors(errArray) {
	var allNull = errArray.every((err) => { return (err === null) });
	return !(allNull); 
}

// Inserting into FriendGroup database
function createFriendGroup(creator, groupName, description) {
	var query = "INSERT INTO FriendGroup(group_name, username, description) VALUES (?, ?, ?)";
	connection.query(query, [groupName, creator, description], function(err, rows, fields) {
		if (err) throw err;
	});
	return;
}

// Inserting into Member database
function addMemberToGroup(member, group, creator) {
	var query = "INSERT INTO Member(username, group_name, username_creator) VALUES (?, ?, ?)";
	connection.query(query, [member, group, creator], function (err, rows, fields) {
		if (err) throw err;
	});
	return; 
}

// Displaying only one content 
// Shows content's contentInfo, users who were tagged, and comments 
app.get('/content/:id', function(req, res) {
	if (typeof req.session.username === 'undefined') return res.redirect('/');
	var id = req.params.id;
	var username = req.session.username;
	displayContentPage(id, username)
		.then((content) => {
			content.err = req.session.err;
			content.success = req.session.success;
			req.session.success = null;
			req.session.err = null;
			content.error = (typeof content.err !== 'undefined' && content.err !== null);
			getShareGroups(id, username)
				.then((groups) => {
					content.share = groups;
					res.render('content', content);
				})
		})
})

// User who created content can edit the content_name and/or change content to public
// If content changed to public, content is still shared to original FriendGroups
// On home page, content has new "Public" tag for "Shared From" label
app.post('/content/:contentId/edit', function(req, res) {
	var id = req.params.contentId;
	var contentName = req.body.content_name;
	var isPublic = (req.body.public === 'on');
	var query = "UPDATE Content SET content_name = ?, public = ? WHERE id = ?";
	connection.query(query, [contentName, isPublic, id], function (err, rows, fields) {
		if (err) throw err;
	});
	return res.redirect('/content/' + id);
})

// Deleting a content
// 1) Delete from FriendGroups table
// 2) Delete from Tags table 
// 3) Delete from Comment table
// 3) Delete from Content table 
app.post('/content/:id/delete', function(req, res) {
	var id = req.params.id; 
	var tables = ['Share', 'Tag', 'Comment', 'Content'];
	var promises = tables.map((table) => deleteContentFrom(table, id));
	return Promise.all(promises)
		.then(res.redirect('/home'));
})

// User who owns content can share it to other FriendGroups he/she is a member of
app.post('/content/:contentId/share', function(req, res) {
	var id = req.params.contentId;
	var groups = (Array.isArray(req.body.group_name)) ? req.body.group_name : new Array(req.body.group_name);
	var promises = groups.map((group) => shareContent(id, group));
	Promise.all(promises)
		.then(() => {
			req.session.success = "You have successfully shared this content";
			res.redirect('/content/' + id);
		})
})

// Deletes content from each table 
function deleteContentFrom(table, id) {
	var query = "DELETE FROM " + table + " WHERE id = ?";
	return connection.query(query, id, function(err, rows, fields) {
		if (err) throw err;
	})
}

function displayContentPage(id, username) {
	var content = {
		error: false, 
		err: null,
		username: username
	}

	return Promise.all([getContentInfo(id), getTags(id), getComments(id)])
		.then((results) => {
			content.contentInfo = results[0][0];
			content.tagged = results[1];
			content.comments = results[2];
			return content; 
		})
}

// Get FriendGroups content is shared to
function getShareGroups(id, username) {
	var query = "SELECT username_creator, group_name FROM Member WHERE username = ? " + 
				"AND (username_creator, group_name) NOT IN " + 
				"(SELECT username, group_name FROM Share WHERE id = ?)";
	return new Promise((resolve, reject) => {
		connection.query(query, [username, id], (err, rows) => {
			if (err) return reject(err);
			if (rows.length === 0) resolve(null)
			else resolve(rows);
		})
	})
}

// Gets all attributes from Content database for id
function getContentInfo(id) {
	var query = "SELECT * FROM Content WHERE id = ?";
	return new Promise((resolve, reject) => {
		connection.query(query, id, (err, rows) => {
			if (err) return reject(err);
			resolve(rows);
		})
	})
}

// Gets a person's information from Person database if tagged in content with id = id
function getTags(id) {
	var query = "SELECT first_name, last_name, username_taggee FROM Tag, Person WHERE Tag.username_taggee = Person.username " +
				"AND status IS true AND id = ?";
	return new Promise((resolve, reject) => {
		connection.query(query, id, (err, rows) => {
			if (err) return reject(err);
			if (rows.length === 0) resolve(null);
			else { resolve(rows); }
		})
	})
}

// Gets all comments of a Content with id = id 
function getComments(id) {
	var query = "SELECT * FROM Comment WHERE id = ?";
	return new Promise((resolve, reject) => {
		connection.query(query, id, (err, rows) => {
			if (err) return reject(err);
			if (rows.length === 0) resolve(null);
			else { resolve(rows); }
		})
	})
}

// User is attempting to add a tag (or multiple tags) on a content 
app.post('/content/:contentId/add-tags', function(req, res) {
	var id = req.params.contentId;
	var tagger = req.session.username;
	var tagged = (Array.isArray(req.body.tags)) ? req.body.tags : new Array(req.body.tags);
	var usersExist = tagged.map((taggee) => checkUserExists(taggee));
	var checkVisibility = tagged.map((taggee) => checkContentVisible(id, taggee));
	return Promise.all(usersExist) 
		.then((errArray) => {
			if (checkAnyErrors(errArray) === true) {
				req.session.err = errArray;
				res.redirect('/content/' + id);
			} else {
				// If there is not tagged user that does not exist, continue checking for errors
				// If user is self tagging, insert into Tag with status = true
				// Else if content is visible to tagged user, insert into Tag with status = false
				// Else if content is not visible to tagged user, display error message
				return Promise.all(checkVisibility)
					.then((errArray) => {
						if (checkAnyErrors(errArray) === true) {
							req.session.err = errArray;
							res.redirect('/content/' + id);
						} else {
							var tagging = tagged.map((taggee) => addTag(tagger, taggee, id));
							return Promise.all(tagging)
								.then(() => {
									req.session.success = "The tag you have added will be sent to the user(s) for approval";
									res.redirect('/content/' + id);
								})
						}
					})
			}
		})
})

// Checking if content is visible to user
// This means either content is public to everyone or 
// content is shared to a FriendGroup user is a member of
function checkContentVisible(id, user) {
	var query = "SELECT * FROM Content NATURAL LEFT JOIN Share WHERE id = ? AND (Content.public is true " +
				"OR (group_name, username) IN " +
				"(SELECT group_name, username_creator FROM Member WHERE username = ?))"
	return new Promise((resolve, reject) => {
		connection.query(query, [id, user], (err, rows) => {
			if (err) return reject(err);
			// If rows = 0, content is not visible to user (resolve errString)
			// Else, content is visible to user (resolved to null)
			if (rows.length === 0) {
				var errString = "The content is not visible to " + user;
				resolve(errString);
			} else { resolve(null); }
		})
	})
}

// Adding tag to Tag table 
function addTag(tagger, taggee, id) {
	var status = (tagger === taggee);
	var query = "INSERT INTO Tag(id, username_tagger, username_taggee, status) VALUES (?, ?, ?, ?)"; 
	connection.query(query, [id, tagger, taggee, status], function(err, rows, fields) {
		if (err) throw err;
	})
}

// User is commenting on a content 
app.post('/content/:contentId', function(req, res) {
	var comment = req.body.comment;
	var username = req.session.username;
	var id = req.params.contentId;
	var query = "INSERT INTO Comment(id, username, comment_text) VALUES (?, ?, ?)";
	connection.query(query, [id, username, comment], function(err, rows, fields) {
		if (err) throw err; 
	})
	res.redirect('/content/' + id);
})

// Separate FriendGroups that user has created from FriendGroups user is a member of
// Display FriendGroup name, description, creator (if not user), and members 
app.get('/FriendGroups', function(req, res) {
	if (typeof req.session.username === 'undefined') return res.redirect('/');
	var username = req.session.username;
	var FriendGroups = req.session.FriendGroups || [];
	displayFriendGroupPage(FriendGroups, username)
		.then((results) => {
			results.err = req.session.err;
			results.action = (typeof req.session.action !== 'undefined') ? req.session.action : null;
			results.error = (typeof results.err !== 'undefined' && results.err !== null);
			results.success = req.session.success;
			req.session.success = null; 
			req.session.err = null;
			req.session.action = null;
			res.render('friendGroups', results);
		})

})

function displayFriendGroupPage(FriendGroups, username) {
	var ownedByUser = FriendGroups.filter(group => group.username_creator === group.username);
	var memberOfGroup = FriendGroups.filter(group => group.username_creator !== group.username);
	var groupMembers = FriendGroups.map((group) => getMembersOfGroup(group));

	var FriendGroupPage = {
		error: false,
		err: null,
		username: username,
		ownedByUser: ownedByUser,
		memberOfGroup: memberOfGroup
	}

	return Promise.all(groupMembers) 
		.then((results) => {
			FriendGroupPage.allGroupMembers = results;
			return getUserTags(username)
				.then((tags) => {
					FriendGroupPage.pendingTags = tags
					return FriendGroupPage
				})
		})
}

// Getting all members of a FriendGroup
// Displayed as list when attempting to remove a user from a FriendGroup
function getMembersOfGroup(FriendGroup) {
	var group_name = FriendGroup.group_name;
	var creator = FriendGroup.username_creator;
	var query = "SELECT DISTINCT Member.username, first_name, last_name FROM Member NATURAL JOIN Person, FriendGroup " +
				"WHERE Member.username_creator = FriendGroup.username AND Member.group_name = FriendGroup.group_name " +
				"AND FriendGroup.group_name = ? AND FriendGroup.username = ?";
	return new Promise((resolve, reject) => {
		connection.query(query, [group_name, creator], (err, rows) => {
			if (err) return reject(err);
			var groupInfo = {
				groupName: group_name,
				creator: creator,
				groupMembers: rows
			}
			resolve(groupInfo); 
		})
	})
}

// Getting all pending tags of user 
// Meaning all tags of user that still need approval (or rejection)
function getUserTags(username) {
	var query = "SELECT Content.id, username_tagger, username_taggee, Tag.timest " +
				"FROM Tag, Content WHERE Tag.id = Content.id AND username_taggee = ? AND status IS false";
	return new Promise((resolve, reject) => {
		connection.query(query, username, (err, rows) => {
			if (err) return reject(err);
			if (rows.length === 0) resolve(null);
			else { resolve(rows); }
		})
	})
}

// Tagged user can either approve or decline tag that another user added
// If approve, update tag in Tag table so status = True
// If decline, delete tag from Tag table 
app.post('/tag/:tagId', function(req, res) {
	var status = req.body['tag-status'];
	var username = req.session.username;
	var id = req.params.tagId;
	if (status === 'Approve') {
		var query = "UPDATE Tag SET status = true WHERE id = ? AND username_taggee = ?";
		connection.query(query, [id, username], function(err, rows, fields) {
			if (err) throw err;
		})
	} else { // tag declined, delete entry from Tag table 
		var query = "DELETE FROM Tag WHERE id = ? AND username_taggee = ?";
		connection.query(query, [id, username], function(err, rows, fields) {
			if (err) throw err;
		})
	}
	return res.redirect('/FriendGroups');
})

// Attempting to add a member to the FriendGroup
app.post('/add-member', function(req, res) {
	var username = req.session.username;
	var groupName = req.body['friend-group'];
	var errors = [];
	var addMethod = req.body.method; // either by name or by username
	req.session.action = ['add', groupName];
	var friendGroups = req.session['FriendGroups'];
	// Adding by username - can add more than one member to FriendGroup
	if (addMethod === 'username') {
		var members = req.body.members.split(',');
		// Check if user exists and if user is already a member
		var usersExist = members.map((member) => checkUserExists(member));
		var alreadyMember = members.map((member) => checkUserIsMember(member, groupName, username));
		var promises = usersExist.concat(alreadyMember); 
		Promise.all(promises)
			.then((errStrings) => {
				errors = errStrings;
				if (checkAnyErrors(errStrings) === true) {
					req.session.err = errStrings;
					res.redirect('/FriendGroups');
				} else {
					members.map((member) => addMemberToGroup(member, groupName, username));
					req.session.success = "You have successfully added new members to " + groupName;
					res.redirect('/FriendGroups');
				}
			})
	} else { // Adding by name - can only add one member at a time to FriendGroup
		var member = req.body.member;
		// Checking if user exists - if multiple user with same name, returns error message
		checkUserExistsByName(member)
			.then((userExists) => {
				if (userExists.errString) {
					req.session.err = [userExists.errString];
					res.redirect('/FriendGroups');
				} else { // Checking if user is already a member
					checkUserIsMember(userExists)
						.then((error) => {
							if (error !== null) {
								req.session.err = [error];
								res.redirect('/FriendGroups');
							} else {
								addMemberToGroup(userExists, groupName, username);
								req.session.success = "You have successfully added " + member['first-name'] + " "  + member['last-name'] + " to " + groupName;
								return res.redirect('/FriendGroups');
							}
						})
				}
			})

	}
})

// Used for adding user to FriendGroup
// Checking if user exists by using first name and last name 
// If multiple users with the same first name and last name, displays error message
// If no such user with first name and last name, displays error message
function checkUserExistsByName(member) {
	var query = "SELECT username FROM Person WHERE first_name = ? AND last_name = ?";
	var firstName = member['first-name'];
	var lastName = member['last-name'];
	return new Promise((resolve, reject) => {
		connection.query(query, [firstName, lastName], (err, rows) => {
			if (err) return reject(err);
			var errString = '';
			if (rows.length === 0) {
				errString = { errString: "The user named " + firstName + " " + lastName + " does not exist" };
				resolve(errString);
			} else if (rows.length > 1) {
				errString = { errString: "There are multiple users named " + firstName + " " + lastName + ". Try adding by username instead." };
				resolve(errString);
			} else {
				resolve(rows[0].username);
			}
		})
	})
}

// Checks if user is already a member of the FriendGroup
// If there exists an entry in Member with same group_name and username_creator, return error message
// Else return null to indicate no error
function checkUserIsMember(username, groupName, creator) {
	var query = "SELECT * FROM Member WHERE group_name = ? AND username_creator = ? AND username = ?";
	return new Promise((resolve, reject) => {
		connection.query(query, [groupName, creator, username], (err, rows) => {
			if (err) return reject(err);
			if (rows.length > 0) {
				var errString = "The user " + username + " is already a member of this FriendGroup";
				resolve(errString);
			} else {
				resolve(null);
			}
		})
	})
}

// Remove members from FriendGroup
// Tags of removed member will be removed along with tags they made if status is still false
app.post('/remove-member', function(req, res) {
	var groupName = req.body['friend-group'];
	var members = (Array.isArray(req.body['remove-member'])) ? req.body['remove-member'] : new Array(req.body['remove-member']);
	var username = req.session.username;

	var removeMembers = members.map((member) => removeMemberFromGroup(member, groupName, username));
	var removeTags = members.map((member) => removeTagsOfMember(member, groupName, username));
	return Promise.all([removeMembers, removeTags])
		.then(res.redirect('/FriendGroups'))
})

// Deletes member from a FriendGroup
function removeMemberFromGroup(username, groupName, creator) {
	var query = "DELETE FROM Member WHERE username = ? AND group_name = ? AND username_creator = ?";
	connection.query(query, [username, groupName, creator], function(err, rows) {
		if (err) throw err;
	})
}

// Deletes tags that removed member made that is still pending and 
// Deletes tags of removed member in contents shared to FriendGroup user is no longer a member
function removeTagsOfMember(username, groupName, creator) {
	var query = "DELETE FROM Tag WHERE (username_taggee = ? AND id in " +
				"(SELECT id FROM Share WHERE group_name = ? AND username = ?)) OR " +
				"(username_tagger = ? AND status IS false)";
	connection.query(query, [username, groupName, creator, username], function(err, rows, fields) {
		if (err) throw err; 
	})
}

// User is logging out, end session
app.get('/logout', function(req, res) {
	req.session.destroy();
	res.redirect('/');
})

app.listen(3000, () => console.log("Server running at http://localhost:3000/"));
