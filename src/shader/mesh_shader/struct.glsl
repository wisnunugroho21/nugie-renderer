// ------------- Struct ------------- 

struct TaskPayload {
    uint tessellationSize;
    vec2 taskPositionMin;
    vec2 taskPositionMax;
    vec2 meshPositionMin[64];
    vec2 meshPositionMax[64];
};

struct Transformation {
    mat4 worldToObjectMatrix;
    mat4 objectToWorldMatrix;
};

struct Square {
    vec2 minimum;
    vec2 maximum;
};