package com.streamhouse.tv

import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress

/**
 * Finds StreamHouse on the local network, so nobody has to type an IP address
 * with a TV remote.
 *
 * One broadcast datagram goes out; every server that hears it answers with its
 * address and port. Matches server/discovery.js.
 */
object Discovery {

    private const val PORT = 11472
    private const val PROBE = "STREAMHOUSE_DISCOVER"

    data class Server(val name: String, val url: String)

    /** Runs off the main thread and calls [onResult] back on it. */
    fun find(timeoutMs: Int = 2500, onResult: (List<Server>) -> Unit) {
        Thread {
            val servers = LinkedHashMap<String, Server>()
            var socket: DatagramSocket? = null
            try {
                socket = DatagramSocket().apply {
                    broadcast = true
                    soTimeout = 400
                }
                val probe = PROBE.toByteArray()
                for (target in listOf("255.255.255.255", "224.0.0.1")) {
                    try {
                        socket.send(DatagramPacket(probe, probe.size, InetAddress.getByName(target), PORT))
                    } catch (ignored: Exception) {
                        // Some networks refuse one form of broadcast; the other usually lands.
                    }
                }

                val deadline = System.currentTimeMillis() + timeoutMs
                val buffer = ByteArray(2048)
                while (System.currentTimeMillis() < deadline) {
                    val packet = DatagramPacket(buffer, buffer.size)
                    try {
                        socket.receive(packet)
                    } catch (timeout: Exception) {
                        continue
                    }
                    try {
                        val json = JSONObject(String(packet.data, 0, packet.length))
                        if (json.optString("app") != "streamhouse") continue
                        val port = json.optInt("port", 11471)
                        val host = packet.address.hostAddress ?: continue
                        val url = "http://$host:$port"
                        servers[url] = Server(json.optString("name", host), url)
                    } catch (ignored: Exception) {
                        // Not one of ours.
                    }
                }
            } catch (ignored: Exception) {
                // No network, or broadcast blocked: fall back to typing an address.
            } finally {
                socket?.close()
            }

            val result = servers.values.toList()
            Handler(Looper.getMainLooper()).post { onResult(result) }
        }.start()
    }
}
