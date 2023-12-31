#include "raygen_desc_set.hpp"
#include "../../../vulkan/descriptor/descriptor_writer.hpp"

namespace NugieApp {
  RayGenDescSet::RayGenDescSet(NugieVulkan::Device* device, NugieVulkan::DescriptorPool* descriptorPool,
		const std::vector<VkDescriptorImageInfo> &outputImageInfo, std::vector<VkDescriptorImageInfo> inputImageInfo[4])
		: device{device}, descriptorPool{descriptorPool} 
	{
		this->createDescriptorLayout();
		this->createDescriptorSet(outputImageInfo, inputImageInfo);
  }

	RayGenDescSet::~RayGenDescSet() {
		if (this->descSetLayout != nullptr) delete this->descSetLayout;
	}

	void RayGenDescSet::createDescriptorLayout() {
		this->descSetLayout = 
			NugieVulkan::DescriptorSetLayout::Builder(this->device)
				.addBinding(0, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, VK_SHADER_STAGE_COMPUTE_BIT)
				.addBinding(1, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, VK_SHADER_STAGE_COMPUTE_BIT)
				.addBinding(2, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, VK_SHADER_STAGE_COMPUTE_BIT)
				.addBinding(3, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, VK_SHADER_STAGE_COMPUTE_BIT)
				.addBinding(4, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, VK_SHADER_STAGE_COMPUTE_BIT)
				.build();
	}

  void RayGenDescSet::createDescriptorSet(const std::vector<VkDescriptorImageInfo> &outputImageInfo, 
		std::vector<VkDescriptorImageInfo> inputImageInfo[4]) 
	{	
		this->descriptorSets.clear();
		for (int i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; i++) {
			VkDescriptorSet descSet;

			auto x = NugieVulkan::DescriptorWriter(this->device, this->descSetLayout, this->descriptorPool)
				.writeImage(0, outputImageInfo[i])
				.writeImage(1, inputImageInfo[0][i])
				.writeImage(2, inputImageInfo[1][i])
				.writeImage(3, inputImageInfo[2][i])
				.writeImage(4, inputImageInfo[3][i])
				.build(&descSet);
			
			this->descriptorSets.emplace_back(descSet);
		}
  }

	void RayGenDescSet::overwrite(const std::vector<VkDescriptorImageInfo> &outputImageInfo, 
		std::vector<VkDescriptorImageInfo> inputImageInfo[4]) 
	{
		for (size_t i = 0; i < this->descriptorSets.size(); i++) {
			NugieVulkan::DescriptorWriter(this->device, this->descSetLayout, this->descriptorPool)
				.writeImage(0, outputImageInfo[i])
				.writeImage(1, inputImageInfo[0][i])
				.writeImage(2, inputImageInfo[1][i])
				.writeImage(3, inputImageInfo[2][i])
				.writeImage(4, inputImageInfo[3][i])
				.overwrite(&this->descriptorSets[i]);
		}
	}
}