#include "model_deferred_desc_set.hpp"
#include "../../../vulkan/descriptor/descriptor_writer.hpp"

namespace NugieApp {
  ModelDeferredDescSet::ModelDeferredDescSet(NugieVulkan::Device* device, NugieVulkan::DescriptorPool* descriptorPool,
		std::vector<VkDescriptorBufferInfo> uniformBufferInfo[1], VkDescriptorBufferInfo modelsInfo[2],
		std::vector<VkDescriptorImageInfo> shadowTextureInfo) 
	{
		this->createDescriptor(device, descriptorPool, uniformBufferInfo, modelsInfo, shadowTextureInfo);
  }

	ModelDeferredDescSet::~ModelDeferredDescSet() {
		if (this->descSetLayout != nullptr) delete this->descSetLayout;
	}

  void ModelDeferredDescSet::createDescriptor(NugieVulkan::Device* device, NugieVulkan::DescriptorPool* descriptorPool,
		std::vector<VkDescriptorBufferInfo> uniformBufferInfo[1], VkDescriptorBufferInfo modelsInfo[2],
		std::vector<VkDescriptorImageInfo> shadowPointTextureInfo)
	{
    this->descSetLayout = 
			NugieVulkan::DescriptorSetLayout::Builder(device)
				.addBinding(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_FRAGMENT_BIT)
				.addBinding(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_FRAGMENT_BIT)
				.addBinding(2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_FRAGMENT_BIT)
				.addBinding(3, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, VK_SHADER_STAGE_FRAGMENT_BIT)
				.build();
		
		this->descriptorSets.clear();
		uint32_t lightNum = static_cast<uint32_t>(shadowPointTextureInfo.size() / NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT);

		for (int i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; i++) {
			std::vector<VkDescriptorImageInfo> descShadowPointTextureInfo;

			for (uint32_t j = 0; j < lightNum; j++) {
				descShadowPointTextureInfo.emplace_back(shadowPointTextureInfo[i * lightNum + j]);
			}

			VkDescriptorSet descSet;
			NugieVulkan::DescriptorWriter(device, this->descSetLayout, descriptorPool)
				.writeBuffer(0, uniformBufferInfo[0][i])
				.writeBuffer(1, modelsInfo[0])
				.writeBuffer(2, modelsInfo[1])
				.writeImage(3, descShadowPointTextureInfo)
				.build(&descSet);

			this->descriptorSets.emplace_back(descSet);
		}
  }
}