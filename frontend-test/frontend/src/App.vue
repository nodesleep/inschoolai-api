<script setup lang="ts">
// This is merely a prototyping frontend to test API changes before moving to prod

import { ref, onMounted, onBeforeUnmount, nextTick, watch } from "vue";
import { io, Socket } from "socket.io-client";

// Define types
interface Message {
    id: string;
    sender: string;
    text: string;
    timestamp: string;
    type: "message" | "notification";
}

interface TypingData {
    roomId: string;
    username: string;
    isTyping: boolean;
}

interface SocketError {
    message: string;
}

// State
const socket = ref<Socket | null>(null);
const isLoggedIn = ref<boolean>(false);
const username = ref<string>("");
const roomId = ref<string>("");
const messages = ref<Message[]>([]);
const newMessage = ref<string>("");
const error = ref<string>("");
const typingUsers = ref<string[]>([]);
const typingTimeout = ref<number | null>(null);
const messagesContainer = ref<HTMLElement | null>(null);

// Connect to Socket.IO server
onMounted(() => {
    socket.value = io("http://localhost:3001", {
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
    });

    // Set up event listeners
    setupSocketListeners();
});

// Clean up on component unmount
onBeforeUnmount(() => {
    if (isLoggedIn.value) {
        leaveRoom();
    }
    cleanupSocketConnection();
});

// Setup socket event listeners
const setupSocketListeners = (): void => {
    if (!socket.value) return;

    socket.value.on("connect", () => {
        console.log("Connected to server");
    });

    socket.value.on("connect_error", (err: Error) => {
        error.value = `Connection error: ${err.message}`;
    });

    socket.value.on("error", (err: SocketError) => {
        error.value = err.message || "An error occurred";
    });

    socket.value.on("chat_history", (history: Message[]) => {
        messages.value = history;
        scrollToBottom();
    });

    socket.value.on("message", (message: Message) => {
        messages.value.push(message);
        scrollToBottom();
    });

    socket.value.on(
        "user_typing",
        ({
            username: user,
            isTyping,
        }: {
            username: string;
            isTyping: boolean;
        }) => {
            if (isTyping && !typingUsers.value.includes(user)) {
                typingUsers.value.push(user);
            } else if (!isTyping) {
                typingUsers.value = typingUsers.value.filter((u) => u !== user);
            }
        },
    );

    socket.value.on("disconnect", () => {
        console.log("Disconnected from server");
    });
};

// Join a chat room
const joinRoom = (): void => {
    if (!socket.value || !username.value || !roomId.value) {
        error.value = "Username and room ID are required";
        return;
    }

    socket.value.emit("join_room", roomId.value, username.value);
    isLoggedIn.value = true;
};

// Leave the current room
const leaveRoom = (): void => {
    if (socket.value && isLoggedIn.value) {
        socket.value.emit("leave_room", roomId.value, username.value);
        isLoggedIn.value = false;
        messages.value = [];
        newMessage.value = "";
        typingUsers.value = [];
    }
};

// Send a message
const sendMessage = (): void => {
    if (!newMessage.value.trim() || !socket.value || !isLoggedIn.value) return;

    // Log what we're sending to help debug
    console.log("Sending message with data:", {
        roomId: roomId.value,
        message: {
            sender: username.value,
            text: newMessage.value.trim(),
        },
    });

    // Send the message - making sure format matches exactly what backend expects
    socket.value.emit("send_message", {
        roomId: roomId.value,
        message: {
            sender: username.value,
            text: newMessage.value.trim(),
        },
    });

    // Clear typing indicator
    socket.value.emit("typing", {
        roomId: roomId.value,
        username: username.value,
        isTyping: false,
    });

    // Reset input
    newMessage.value = "";
};

// Handle typing indicator
const handleTyping = (): void => {
    if (!socket.value || !isLoggedIn.value) return;

    // Clear existing timeout
    if (typingTimeout.value) {
        clearTimeout(typingTimeout.value);
    }

    // Send typing indicator
    socket.value.emit("typing", {
        roomId: roomId.value,
        username: username.value,
        isTyping: true,
    } as TypingData);

    // Set timeout to clear typing indicator
    typingTimeout.value = window.setTimeout(() => {
        if (socket.value) {
            socket.value.emit("typing", {
                roomId: roomId.value,
                username: username.value,
                isTyping: false,
            } as TypingData);
        }
    }, 2000);
};

// Format timestamp to a readable time
const formatTime = (timestamp: string): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

// Scroll to the bottom of the messages container
const scrollToBottom = async (): Promise<void> => {
    await nextTick();
    if (messagesContainer.value) {
        messagesContainer.value.scrollTop =
            messagesContainer.value.scrollHeight;
    }
};

// Cleanup socket connection
const cleanupSocketConnection = (): void => {
    if (socket.value) {
        socket.value.off("connect");
        socket.value.off("connect_error");
        socket.value.off("error");
        socket.value.off("chat_history");
        socket.value.off("message");
        socket.value.off("user_typing");
        socket.value.off("disconnect");
        socket.value.disconnect();
    }

    // Also clear any timeouts
    if (typingTimeout.value) {
        clearTimeout(typingTimeout.value);
    }
};

// Watch for changes in messages and scroll to bottom
watch(messages, () => {
    scrollToBottom();
});
</script>

<template>
    <div class="flex flex-col h-screen max-w-4xl mx-auto">
        <div
            v-if="!isLoggedIn"
            class="flex-1 flex flex-col justify-center items-center p-8"
        >
            <div class="w-full max-w-md bg-white p-8 rounded-lg shadow-lg">
                <h2 class="text-xl font-semibold mb-6 text-center">
                    Join a chat room
                </h2>
                <form @submit.prevent="joinRoom" class="space-y-4">
                    <div>
                        <label
                            for="username"
                            class="block text-sm font-medium text-gray-700 mb-1"
                            >Username:</label
                        >
                        <input
                            id="username"
                            v-model="username"
                            type="text"
                            placeholder="Enter your username"
                            required
                            class="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>
                    <div>
                        <label
                            for="roomId"
                            class="block text-sm font-medium text-gray-700 mb-1"
                            >Room ID:</label
                        >
                        <input
                            id="roomId"
                            v-model="roomId"
                            type="text"
                            placeholder="Enter room ID"
                            required
                            class="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>
                    <button
                        type="submit"
                        class="w-full bg-indigo-600 text-white py-2 px-4 rounded-md hover:bg-indigo-700 transition duration-200"
                    >
                        Join Room
                    </button>
                </form>
            </div>
        </div>

        <div
            v-else
            class="flex-1 flex flex-col bg-white rounded-lg shadow-lg overflow-hidden"
        >
            <div
                class="bg-gray-100 border-b border-gray-200 p-4 flex justify-between items-center"
            >
                <h2 class="text-lg font-semibold">Room: {{ roomId }}</h2>
                <button
                    @click="leaveRoom"
                    class="bg-red-600 text-white py-1 px-4 rounded-md hover:bg-red-700 transition duration-200"
                >
                    Leave Room
                </button>
            </div>

            <div
                ref="messagesContainer"
                class="flex-1 p-4 overflow-y-auto flex flex-col gap-2"
            >
                <div
                    v-if="messages.length === 0"
                    class="text-center text-gray-500 my-auto"
                >
                    No messages yet. Start the conversation!
                </div>

                <div
                    v-for="message in messages"
                    :key="message.id"
                    :class="[
                        'max-w-[50%] p-3 rounded-lg',
                        message.type === 'notification'
                            ? 'self-center text-gray-500 italic w-[100%] text-center'
                            : message.sender === username
                              ? 'self-end bg-indigo-600 text-white'
                              : 'self-start bg-gray-200',
                    ]"
                >
                    <div class="flex justify-between mb-1 text-xs">
                        <span class="font-semibold">{{
                            message.sender === "system" ? "" : message.sender
                        }}</span>
                        <span
                            :class="
                                message.sender === username
                                    ? 'ml-3 text-indigo-200'
                                    : message.sender === 'system'
                                      ? 'hidden'
                                      : 'ml-3 text-gray-500'
                            "
                        >
                            {{ formatTime(message.timestamp) }}
                        </span>
                    </div>
                    <div>{{ message.text }}</div>
                </div>
            </div>

            <div
                v-if="typingUsers.length > 0"
                class="px-4 py-2 text-sm italic text-gray-600"
            >
                {{ typingUsers.join(", ") }}
                {{ typingUsers.length === 1 ? "is" : "are" }} typing...
            </div>

            <div class="border-t border-gray-200 p-4">
                <form @submit.prevent="sendMessage" class="flex gap-2">
                    <input
                        v-model="newMessage"
                        type="text"
                        placeholder="Type a message..."
                        @input="handleTyping"
                        class="flex-1 px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <button
                        type="submit"
                        class="bg-indigo-600 text-white py-2 px-6 rounded-md hover:bg-indigo-700 transition duration-200"
                    >
                        Send
                    </button>
                </form>
            </div>
        </div>

        <div
            v-if="error"
            class="fixed top-4 right-4 bg-red-600 text-white px-4 py-3 rounded-md shadow-lg flex items-center gap-4 z-10"
        >
            {{ error }}
            <button @click="error = ''" class="text-xl font-bold">
                &times;
            </button>
        </div>
    </div>
</template>
