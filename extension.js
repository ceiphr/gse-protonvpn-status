const { St, Clutter, Gio, GLib, GObject } = imports.gi;
const { panelMenu, popupMenu, main } = imports.ui;
const AggregateMenu = main.panel.statusArea.aggregateMenu;
const Lang = imports.lang;
const Mainloop = imports.mainloop;

let vpnStatusIndicator;

// https://andyholmes.github.io/articles/subprocesses-in-gjs.html
function execCommunicate(argv, input = null, cancellable = null) {
	let flags =
		Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE;

	let proc = Gio.Subprocess.new(argv, flags);

	return new Promise((resolve, reject) => {
		proc.communicate_utf8_async(input, null, (proc, res) => {
			try {
				let [, stdout, stderr] = proc.communicate_utf8_finish(res);
				let status = proc.get_exit_status();

				if (status !== 0) {
					throw new Gio.IOErrorEnum({
						code: Gio.io_error_from_errno(status),
						message: stderr ? stderr.trim() : GLib.strerror(status),
					});
				}

				resolve(stdout.trim());
			} catch (e) {
				reject(e);
			}
		});
	});
}

class ProtonVPN {
	constructor() {
		this._commands = {
			connect: "sudo protonvpn connect -f",
			disconnect: "sudo protonvpn disconnect",
		};
	}

	/**
	 * Call ProtonVPN Command Line Tool to connect to the VPN Service
	 */
	connect() {
		GLib.spawn_command_line_async(this._commands.connect);
		vpnStatusIndicator.update("Loading");
	}

	/**
	 * Call ProtonVPN Command Line Tool to disconnect to the VPN Service
	 */
	disconnect() {
		GLib.spawn_command_line_async(this._commands.disconnect);
		vpnStatusIndicator.update("Loading");
	}

	/**
	 * Call ProtonVPN Command Line Tool to get the status of the VPN connection
	 *
	 * @returns {status: string}
	 */
	getStatus() {
		let argv = ["protonvpn", "status"]; // status checking command is "protonvpn status"
		const data = execCommunicate(argv);
		execCommunicate(argv)
			.then((result) => {
				// Success
				let rawStatus = result.toString().trim();

				const splitStatus = rawStatus.split("\n");
				const connectionLine = splitStatus.find((line) =>
					line.includes("Status:")
				);
				this._vpnCurrentState = connectionLine
					? connectionLine.replace("Status:", "").trim()
					: "Unknown";

				vpnStatusIndicator.update(this._vpnCurrentState);
			})
			.catch((e) => {
				// Error
				logError(e);
			});
	}
}

const VPNStatusIndicator = GObject.registerClass(
	class VPNStatusIndicator extends panelMenu.SystemIndicator {
		_init() {
			super._init();

			// Add the indicator to the indicator bar
			this._indicator = this._addIndicator();
			this._indicator.icon_name = "network-vpn-symbolic";
			this._indicator.visible = false;

			// Build a menu

			// main item with the header section
			this._item = new popupMenu.PopupSubMenuMenuItem("ProtonVPN", true);
			this._item.icon.icon_name = "network-vpn-symbolic";
			this._item.label.clutter_text.x_expand = true;
			this.menu.addMenuItem(this._item);

			// Initiate ProtonVPN handler
			this.pvpn = new ProtonVPN();

			// Add elements to the UI
			AggregateMenu._indicators.insert_child_at_index(this.indicators, 0);
			AggregateMenu.menu.addMenuItem(this.menu, 4);
			this._connectItem = this._item.menu.addAction(
				"Connect",
				this._toggleConnection.bind(this)
			);
		}

		enable() {
			this._refresh();
		}

		/**
		 * Determine whether to connect or disconnect based on 
		 * _connectItem's current label
		 *
		 * @private
		 */
		_toggleConnection() {
			if(this._connectItem.label.text == "Connect")
				this._connect();
			else if (this._connectItem.label.text == "Disconnect")
				this._disconnect();
		}

		/**
		 * Call ProtonVPN Command Line Tool to connect to the VPN Service
		 *
		 * @private
		 */
		_connect() {	
			this.pvpn.connect();
		}

		/**
		 * Call ProtonVPN Command Line Tool to connect to the VPN Service
		 *
		 * @private
		 */
		_disconnect() {
			this.pvpn.disconnect();
		}

		/**
		 * Call ProtonVPN Command Line Tool to get the current status of the connection
		 *
		 * @private
		 */
		_refresh() {
			this.pvpn.getStatus();

			if (this._timeout) {
				Mainloop.source_remove(this._timeout);
				this._timeout = null;
			}

			// the refresh function will be called every 10 sec.
			this._timeout = Mainloop.timeout_add_seconds(
				10,
				Lang.bind(this, this._refresh)
			);
		}

		/**
		 * Updates the widgets based on ProtonVPN's reported status
		 *
		 * @param vpnStatus Current status of your ProtonVPN connection
		 */
		update(vpnStatus) {
			// Update the panel button
			this._item.label.text = `ProtonVPN ${vpnStatus}`;

			if (vpnStatus == "Connected") {
				this._indicator.icon_name = "network-vpn-symbolic";
				this._indicator.visible = true;
				this._connectItem.label.text = "Disconnect";
			} else if (vpnStatus == "Loading") {
				this._indicator.icon_name = "network-vpn-acquiring-symbolic";
				this._indicator.visible = true;
				this._connectItem.label.text = "Waiting for ProtonVPN";
			} else {
				this._indicator.icon_name = "network-vpn-symbolic";
				this._indicator.visible = false;
				this._connectItem.label.text = "Connect";
			}
		}

		destroy() {
			if (this._timeout) Mainloop.source_remove(this._timeout);
			this._timeout = undefined;

			// Call destroy on the parent
			this._indicator.destroy();
			this._item.destroy();
		}
	}
);

function init() {}

function enable() {
	// Init the indicator
	vpnStatusIndicator = new VPNStatusIndicator();
	vpnStatusIndicator.enable();
}

function disable() {
	// Remove the indicator from the panel
	vpnStatusIndicator.destroy();
	vpnStatusIndicator = null;
}
