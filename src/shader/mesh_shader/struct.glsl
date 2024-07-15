// ------------- Struct ------------- 

struct TaskPayload {
    uint tessellationSize;
    vec2 rangeCoordMin;
    vec2 rangeCoordMax;
};

struct Transformation {
    mat4 worldToObjectMatrix;
    mat4 objectToWorldMatrix;
};