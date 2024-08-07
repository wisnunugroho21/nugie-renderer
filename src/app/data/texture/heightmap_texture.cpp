#include "heightmap_texture.hpp"

#include <vulkan/vulkan.h>
#include <stdexcept>
#include <cmath>

namespace NugieApp {
    HeightMapTexture::HeightMapTexture(NugieVulkan::Device* device, NugieVulkan::CommandBuffer* commandBuffer, const std::vector<float> &heightPoints) : Texture(device) {
        this->createImage(commandBuffer, heightPoints);
        this->createSampler();
    }

    void HeightMapTexture::createImage(NugieVulkan::CommandBuffer* commandBuffer, const std::vector<float> &heightPoints) {
        uint32_t sqrSize = sqrt(static_cast<uint32_t>(heightPoints.size()));
        uint32_t mipLevels = static_cast<uint32_t>(std::floor(std::log2(std::max(sqrSize, sqrSize)))) + 1;

        this->stagingBuffer = new NugieVulkan::Buffer(this->device,
                                                      sizeof(float),
                                                      static_cast<uint32_t>(heightPoints.size()),
                                                      VK_BUFFER_USAGE_TRANSFER_SRC_BIT,
                                                      VMA_MEMORY_USAGE_AUTO,
                                                      VMA_ALLOCATION_CREATE_HOST_ACCESS_SEQUENTIAL_WRITE_BIT | VMA_ALLOCATION_CREATE_MAPPED_BIT);

        this->stagingBuffer->map();
        this->stagingBuffer->writeToBuffer((void*) heightPoints.data());

        this->image = new NugieVulkan::Image(this->device, sqrSize, sqrSize, 1u, VK_SAMPLE_COUNT_1_BIT, 
                                             VK_FORMAT_R32_SFLOAT, VK_IMAGE_TILING_OPTIMAL, 
                                             VK_IMAGE_USAGE_TRANSFER_DST_BIT | VK_IMAGE_USAGE_SAMPLED_BIT, 
                                             VMA_MEMORY_USAGE_AUTO, VMA_ALLOCATION_CREATE_DEDICATED_MEMORY_BIT, VK_IMAGE_ASPECT_COLOR_BIT);

        this->image->transitionImageLayout(commandBuffer, 
                                           VK_IMAGE_LAYOUT_UNDEFINED, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, 
                                           VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, 
                                           0, VK_ACCESS_TRANSFER_WRITE_BIT);
        
        this->stagingBuffer->copyBufferToImage(commandBuffer, this->image);

        this->image->transitionImageLayout(commandBuffer, 
                                           VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL, 
                                           VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, 
                                           VK_ACCESS_TRANSFER_WRITE_BIT, 0);
    }

    void HeightMapTexture::createSampler() {
        this->sampler = new NugieVulkan::Sampler(this->device, VK_FILTER_LINEAR,
                                                 VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE,
                                                 VK_TRUE, VK_BORDER_COLOR_FLOAT_OPAQUE_BLACK, VK_COMPARE_OP_NEVER,
                                                 VK_SAMPLER_MIPMAP_MODE_LINEAR, static_cast<float>(this->image->getMipLevels()));
    }
} // namespace NugieApp
