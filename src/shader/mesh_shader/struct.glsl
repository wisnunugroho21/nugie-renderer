// ------------- Struct ------------- 

struct TaskPayload {
    uint tessellationSize;
    vec2 taskGroupPositionMin;
    vec2 taskGroupPositionMax;
    vec2 meshGroupPositionMin[64];
    vec2 meshGroupPositionMax[64];
};

struct Transformation {
    mat4 worldToObjectMatrix;
    mat4 objectToWorldMatrix;
};

struct Square {
    vec2 minimum;
    vec2 maximum;
};