const express = require("express");
const { generateSlug } = require("random-word-slugs");
const { ECSClient, RunTaskCommand } = require("@aws-sdk/client-ecs");
const { Server } = require("socket.io");
const Redis = require("ioredis");

const app = express();
const PORT = 9000;

const serviceUri = process.env.REDIS_SERVICE_URI || "";
const subscriber = new Redis(serviceUri);

const io = new Server({ cors: "*" });

io.on("connection", (socket) => {
    socket.on("subscribe", (channel) => {
        socket.join(channel);
        socket.emit("message", `Joined ${channel}`);
    });
});

io.listen(9001, () => console.log("Socket Server 9001"));

const ecsClient = new ECSClient({
    region: process.env.AWS_REGION || "",
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
    },
});

const config = {
    CLUSTER: process.env.ECS_CLUSTER || "",
    TASK: process.env.ECS_TASK_DEFINITION || "",
};

app.use(express.json());

app.post("/project", async (req, res) => {
    const { gitURL } = req.body;
    const projectSlug = generateSlug();

    //container spin
    const command = new RunTaskCommand({
        cluster: config.CLUSTER,
        taskDefinition: config.TASK,
        launchType: "FARGATE",
        count: 1,
        networkConfiguration: {
            awsvpcConfiguration: {
                assignPublicIp: "ENABLED",
                subnets: [
                    process.env.AWS_SUBNET_1 || "",
                    process.env.AWS_SUBNET_2 || "",
                    process.env.AWS_SUBNET_3 || "",
                ].filter(subnet => subnet !== ""),
                securityGroups: [process.env.AWS_SECURITY_GROUP || ""].filter(sg => sg !== ""),
            },
        },
        overrides: {
            containerOverrides: [
                {
                    name: "builder-image01",
                    environment: [
                        { name: "GIT_REPOSITORY_URL", value: gitURL },
                        { name: "PROJECT_ID", value: projectSlug },
                    ],
                },
            ],
        },
    });

    await ecsClient.send(command);
    return res.json({
        status: "queued",
        data: { projectSlug, url: `http://${projectSlug}.localhost:8000` },
    });
});

async function initRedisSubscribe() {
    console.log("Subscrbed to logs");
    subscriber.psubscribe("logs:*");
    subscriber.on("pmessage", (pattern, channel, message) => {
        io.to(channel).emit("message", message);
    });
}

app.listen(PORT, () => {
    console.log(`Api server running...PORT:${PORT}`);
    initRedisSubscribe();
});