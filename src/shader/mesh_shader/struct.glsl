// ------------- Struct ------------- 

struct TaskPayload {
    uint tessellationSize;
    vec2 rangeCoordMin[64];
    vec2 rangeCoordMax[64];
};

struct Transformation {
    mat4 worldToObjectMatrix;
    mat4 objectToWorldMatrix;
};

struct Square {
    vec2 minimum;
    vec2 maximum;
};